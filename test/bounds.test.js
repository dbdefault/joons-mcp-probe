import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { probe, renderJson, renderMarkdown, redact } from '../src/index.js';
import { createTransport } from '../src/transports.js';
const fixture = fileURLToPath(new URL('./core-fixtures/server.js', import.meta.url));
const target = mode => ({ transport:'stdio', command:process.execPath, args:[fixture,mode] });
test('maxTools stops collecting at the configured count', async () => {
  const r = await probe(target('many'), { maxTools:3 });
  assert.equal(r.status,'FAIL'); assert.equal(r.tools.count,3); assert.ok(r.findings.some(f => f.id === 'TOOLS_LIMIT_EXCEEDED'));
});
test('default bounds stop at 10000 tools and 4 MiB per message', async () => {
  const tools=await probe(target('many-default'));
  assert.equal(tools.tools.count,10000);assert.ok(tools.findings.some(f=>f.id==='TOOLS_LIMIT_EXCEEDED'));
  const bytes=await probe(target('huge-default'));
  assert.equal(bytes.failure?.kind,'invalid_response');assert.ok(bytes.findings.some(f=>f.id==='RESPONSE_TOO_LARGE'));
});
test('per-message and aggregate bytes produce deterministic invalid_response', async () => {
  for (const [mode, options] of [['huge',{maxResponseBytes:2000}],['notify',{maxTotalResponseBytes:3000}]]) {
    const r = await probe(target(mode),options);
    assert.equal(r.failure?.kind,'invalid_response'); assert.ok(r.findings.some(f => f.id === 'RESPONSE_TOO_LARGE'));
  }
});
test('HTTP JSON and SSE bodies are bounded before SDK parsing', async () => {
  for (const sse of [false,true]) {
    const server = createServer((req,res) => {
      res.writeHead(200,{'Content-Type':sse ? 'text/event-stream' : 'application/json'});
      res.end(sse ? `data: ${'z'.repeat(10000)}\n\n` : JSON.stringify({padding:'z'.repeat(10000)}));
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    try {
      const r = await probe({transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`},{maxResponseBytes:1024});
      assert.equal(r.failure?.kind,'invalid_response'); assert.ok(r.findings.some(f => f.id === 'RESPONSE_TOO_LARGE'));
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
test('a stuck Windows cleanup dependency cannot exceed closeTimeoutMs', {skip:process.platform!=='win32'}, async () => {
  const session = createTransport(target('pid'),65536,{closeTimeoutMs:100,runCommand:() => new Promise(() => {})});
  await session.transport.start(); const begin = performance.now();
  await session.close(); assert.ok(performance.now()-begin < 1100);
  assert.ok(session.state.cleanupWarning); await new Promise(resolve => setTimeout(resolve,30));
  assert.throws(() => process.kill(session.state.pid,0),{code:'ESRCH'});
});
test('probe total plus close budget includes process cleanup', async () => {
  const begin = performance.now();
  const r = await probe(target('hang'),{totalTimeoutMs:200,closeTimeoutMs:150,stepTimeoutMs:5000});
  assert.equal(r.failure?.kind,'timeout'); assert.ok(performance.now()-begin < 1350);
  assert.ok(r.timings.totalMs >= 200); assert.ok(r.timings.totalMs < 200 + 150 + 1000);
});
test('all nonempty secrets including regex metacharacters are masked', () => {
  for (const secret of ['Q','QZ','QZX','.','*','[']) assert.equal(redact(`(${secret})`,[secret]),'(***)');
});
test('1-3 character env secrets survive neither JSON nor Markdown', async () => {
  for (const secret of ['Ж','ЖЮ','ЖЮЯ']) {
    const r = await probe({...target('secret'),env:{FIXTURE_SECRET:secret}});
    assert.ok(r.findings.some(f => f.id === 'SECRET_IN_RESPONSE'));
    for (const render of [renderJson,renderMarkdown]) assert.ok(!render(r).includes(secret));
  }
});
test('stderr scanning handles a UTF-8 secret split inside a character', async () => {
  const secret='ЖЮ';
  const r=await probe({...target('split-secret'),env:{FIXTURE_SECRET:secret}},{maxStderrBytes:1});
  assert.ok(r.findings.some(f=>f.id==='SECRET_IN_RESPONSE'));assert.ok(!JSON.stringify(r).includes(secret));
});
test('1-3 character header and query secrets are masked in both renderers', async () => {
  const server = createServer(async (req,res) => {
    let data=''; for await (const chunk of req) data+=chunk;
    if (!data) {res.writeHead(405);res.end();return;}
    const m=JSON.parse(data); if (!m.id && m.id!==0) {res.writeHead(202);res.end();return;}
    const secret = req.headers['x-secret'] || new URL(req.url,'http://127.0.0.1').searchParams.get('key');
    const result = m.method==='initialize' ? {protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:secret,version:'1'}} : {tools:[{name:secret,description:secret,inputSchema:{type:'object'}}]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for (const source of ['header','query']) for (const secret of ['§','§±','§±¶']) {
      const url=`http://127.0.0.1:${server.address().port}/mcp${source==='query'?`?key=${encodeURIComponent(secret)}`:''}`;
      const r=await probe({transport:'http',url,...(source==='header'?{headers:{'X-Secret':secret}}:{})});
      assert.equal(r.failure,null);assert.ok(r.findings.some(f=>f.id==='SECRET_IN_RESPONSE'));
      for (const render of [renderJson,renderMarkdown]) assert.ok(!render(r).includes(secret));
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
});
