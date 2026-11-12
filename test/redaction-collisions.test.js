import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { probe, renderJson, renderMarkdown, redact } from '../src/index.js';
import { redactReport } from '../src/redact.js';

function capabilities() {
  return Object.fromEntries(Array.from({length:8192},(_,i)=>[
    i.toString(2).padStart(13,'0').replaceAll('0','aa').replaceAll('1','bb'),{first:i===0}
  ]));
}
test('8192 colliding HTTP capability keys finish within A1 and redaction takes less than 2 seconds',async()=>{
  const data=capabilities();
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    if(!raw){res.writeHead(405).end();return;}
    const m=JSON.parse(raw);
    if(m.id===undefined){res.writeHead(202).end();return;}
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-11-25',serverInfo:{name:'review',version:'1'},capabilities:{experimental:data}}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const begin=performance.now();
    const r=await probe({transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`},{secrets:['aa','bb'],stepTimeoutMs:500,totalTimeoutMs:700,closeTimeoutMs:50});
    assert.ok(performance.now()-begin<1750,'complete probe exceeds A1 deadline');
    assert.equal(r.failure,null);
    assert.deepEqual(Object.values(r.server.capabilities.experimental),[{first:true}]);
    const findings=r.findings.filter(f=>f.id==='REDACTED_KEYS_MERGED');
    assert.equal(findings.length,1);assert.equal(findings[0].severity,'info');assert.equal(findings[0].category,'security');assert.match(findings[0].message,/8191/);
    const redactStart=performance.now();
    const sanitized=redactReport({status:'PASS',server:{capabilities:data},findings:[]},['aa','bb']);
    assert.ok(performance.now()-redactStart<2000,'redaction exceeds 2 seconds');
    assert.equal(Object.keys(sanitized.server.capabilities).length,1);
    for(const output of [renderJson(r),renderMarkdown(r)])for(const secret of ['aa','bb'])assert.ok(!output.includes(secret));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('collisions retain the first value without suffix secrets in JSON or Markdown',()=>{
  const secrets=['1','2','aa','bb'];
  const input={status:'PASS',server:{capabilities:{a1:{value:'first'},a2:{value:'later'},aa:{value:'first'},bb:{value:'later'}}},findings:[]};
  const result=redactReport(input,secrets);
  assert.deepEqual(result.server.capabilities,{'a***':{value:'first'},'***':{value:'first'}});
  assert.equal(result.status,'PASS');
  assert.equal(result.findings.length,1);assert.equal(result.findings[0].id,'REDACTED_KEYS_MERGED');
  assert.match(result.findings[0].message,/Dropped \*\*\* colliding/);
  for(const output of [renderJson(result),renderMarkdown(result),JSON.stringify(redact(input.server.capabilities,secrets))]) {
    for(const secret of secrets)assert.ok(!output.includes(secret),`generated output contains ${secret}`);
    assert.ok(!output.includes('[2]'));
  }
  assert.equal(redactReport(result,secrets).findings.filter(f=>f.id==='REDACTED_KEYS_MERGED').length,1);
  assert.equal(input.server.capabilities.a2.value,'later');
});
