import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTransport } from '../src/transports.js';
test('stderr keeps a bounded tail and close is idempotent', async () => {
  const s = createTransport({ transport:'stdio', command:process.execPath, args:[fileURLToPath(new URL('./core-fixtures/server.js',import.meta.url)), 'noise'] }, 20);
  await s.transport.start();
  await new Promise(resolve => setTimeout(resolve,200));
  await assert.rejects(s.transport.send({ jsonrpc:'2.0', method:'tools/call' }), /allowlist/);
  await s.close(); await s.close();
  assert.equal(s.state.truncated,true); assert.ok(s.state.stderrTail.length <= 20); assert.match(s.state.stderrTail,/TAIL$/);
  assert.throws(() => process.kill(s.state.pid,0), {code:'ESRCH'});
});
test('Windows cleanup removes the descendant process as well as the server', { skip: process.platform !== 'win32' }, async () => {
  const s = createTransport({ transport:'stdio', command:process.execPath, args:[fileURLToPath(new URL('./core-fixtures/server.js',import.meta.url)), 'tree'] });
  await s.transport.start();
  const deadline = Date.now() + 2000;
  while (!s.state.stderrTail.includes('descendant:') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve,20));
  const descendant = Number(/descendant:(\d+)/.exec(s.state.stderrTail)?.[1]);
  try { assert.ok(descendant > 0); } finally { await s.close(); }
  assert.throws(() => process.kill(s.state.pid,0), {code:'ESRCH'});
  assert.throws(() => process.kill(descendant,0), {code:'ESRCH'});
});
