import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { probe } from '../src/probe.js';
const fixture = fileURLToPath(new URL('./core-fixtures/server.js', import.meta.url));
const run = (mode, options = {}) => probe({ transport: 'stdio', command: process.execPath, args: [fixture, mode] }, { stepTimeoutMs: 1500, ...options });
test('success, pagination, missing capability, and raw malformed tools', async () => {
  assert.equal((await run('ok')).status, 'PASS');
  assert.equal((await run('pages')).tools.pages, 2);
  assert.equal((await run('no-tools')).status, 'WARNING');
  assert.ok((await run('incomplete')).findings.some(f => f.id === 'SERVER_INFO_INCOMPLETE'));
  const malformed = await run('malformed'); assert.equal(malformed.failure, null); assert.equal(malformed.tools.count, 2);
  assert.ok((await run('loop')).findings.some(f => f.id === 'TOOLS_PAGINATION_LOOP'));
});
for (const [mode, kind] of [['exit','process_exited'], ['hang','timeout'], ['hang-tools','timeout'], ['version','protocol_mismatch'], ['invalid','invalid_response'], ['handshake','handshake_failed'], ['badjson','invalid_response']]) {
  test(`classifies ${mode}`, async () => {
    const r = await run(mode, { stepTimeoutMs: 300 }); assert.equal(r.failure?.kind, kind);
    if (mode === 'exit') { assert.equal(r.failure.exitCode, 7); assert.match(r.failure.stderrTail, /failure tail/); }
    if (mode === 'hang-tools') assert.equal(r.failure.step, 'tools_list');
  });
}
test('spawn failure and argument validation', async () => {
  const r = await probe({ transport: 'stdio', command: 'nonexistent-probe-command-000' }); assert.equal(r.failure.kind, 'spawn_failed');
  await assert.rejects(probe({ transport: 'bad' }), TypeError);
  await assert.rejects(run('ok', { stepTimeoutMs: -1 }), TypeError);
});
test('stderr cap and total deadline', async () => {
  const r = await run('noise', { maxStderrBytes: 30 }); assert.ok(r.findings.some(f => f.id === 'STDERR_TRUNCATED'));
  const timeout = await run('hang', { totalTimeoutMs: 200, stepTimeoutMs: 5000 }); assert.equal(timeout.failure.kind, 'timeout'); assert.match(timeout.failure.message, /Total/);
});
test('child PID is gone when probe resolves', async () => {
  const r = await run('pid'); const pid = Number(r.server.name); assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('provided environment secret is masked and detected', async () => {
  const r = await probe({ transport: 'stdio', command: process.execPath, args: [fixture, 'secret'], env: { FIXTURE_SECRET: 'fixture-sensitive-value' } });
  assert.ok(r.findings.some(f => f.id === 'SECRET_IN_RESPONSE'));
  assert.ok(!JSON.stringify(r).includes('fixture-sensitive-value'));
});
test('HTTP auth and refused classification on loopback only', async () => {
  const server = createServer((req,res) => { res.writeHead(Number(req.url.slice(1)) || 403); res.end(); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  try { for (const status of [401,403]) { const r = await probe({ transport:'http', url:`http://127.0.0.1:${port}/${status}` }); assert.equal(r.failure?.kind,'auth_failed'); } }
  finally { await new Promise(resolve => server.close(resolve)); }
  const unused = createServer(); await new Promise(resolve => unused.listen(0,'127.0.0.1',resolve));
  const unusedPort = unused.address().port; await new Promise(resolve => unused.close(resolve));
  const r = await probe({ transport:'http', url:`http://127.0.0.1:${unusedPort}/mcp` }); assert.equal(r.failure?.kind,'connection_refused');
});
