import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const mode = process.argv[2] ?? 'ok';
if (mode === 'exit') { process.stderr.write('failure tail'); process.exit(7); }
if (mode === 'noise') process.stderr.write('x'.repeat(10000) + 'TAIL');
if (mode.startsWith('tree')) {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  process.stderr.write(`descendant:${child.pid}\n`);
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ root: process.pid, descendant: child.pid }));
  if (mode === 'tree-exit') setTimeout(() => process.exit(8), 100);
}
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const m = JSON.parse(line);
  if (!['initialize', 'notifications/initialized', 'tools/list', 'ping'].includes(m.method)) process.exit(91);
  if (m.method === 'initialize') {
    if (mode === 'split-secret') {
      const data=Buffer.from(process.env.FIXTURE_SECRET);
      process.stderr.write(data.subarray(0,1));
      setTimeout(()=>{process.stderr.write(data.subarray(1));reply(m,{protocolVersion:'2025-11-25',serverInfo:{name:'fixture',version:'1'},capabilities:{}});},30);
      return;
    }
    if (mode === 'hang' || mode === 'tree-hang' || mode === 'tree-exit') return;
    if (mode === 'badjson') { process.stdout.write('not json\n'); return; }
    if (mode === 'handshake' || mode === 'tree-error') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'handshake rejected' } }) + '\n'); return; }
    reply(m, { protocolVersion: mode === 'version' ? '2099-01-01' : '2025-11-25', serverInfo: mode === 'incomplete' ? {} : { name: 'fixture', version: '1' }, capabilities: mode === 'no-tools' ? {} : { tools: {} } });
  } else if (m.method === 'tools/list') {
    if (mode === 'hang-tools') return;
    if (mode === 'invalid') return reply(m, { tools: 'wrong' });
    if (mode === 'huge') return reply(m, { tools: [], padding: 'z'.repeat(100000) });
    if (mode === 'huge-default') return reply(m, { tools: [], padding: 'z'.repeat(4*1024*1024) });
    if (mode === 'many-default') return reply(m, { tools: Array.from({ length: 10001 }, (_,i) => ({ name:`echo${i}`,description:'Echo',inputSchema:{type:'object'} })) });
    if (mode === 'many') return reply(m, { tools: Array.from({ length: 12 }, (_,i) => ({ name: `echo${i}`, description: 'Echo', inputSchema: { type: 'object' } })) });
    if (mode === 'notify') {
      for (let i = 0; i < 100; i++) process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/message', params:{ text:'z'.repeat(300) } }) + '\n');
      return;
    }
    const tools = mode === 'malformed' ? [null, { name: 42, inputSchema: false }] : [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }];
    if (mode === 'secret') tools[0].description = process.env.FIXTURE_SECRET;
    reply(m, { tools, ...(mode === 'loop' ? { nextCursor: 'same' } : mode === 'pages' && !m.params?.cursor ? { nextCursor: 'page2' } : {}) });
  }
});
function reply(m, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n'); }
// Include PID in a tool name so tests can verify cleanup after probe resolves.
if (mode === 'pid' || mode === 'tree') {
  lines.removeAllListeners('line');
  lines.on('line', line => {
    const m = JSON.parse(line);
    if (m.method === 'initialize') reply(m, { protocolVersion: '2025-11-25', serverInfo: { name: String(process.pid), version: '1' }, capabilities: {} });
    else if (m.method !== 'notifications/initialized') process.exit(91);
  });
  setInterval(() => {}, 1000);
}
