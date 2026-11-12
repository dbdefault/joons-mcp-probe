import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getFreeClosedPort, startHttpFixture } from './fixtures/run-http.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures');
const script = name => join(root, 'servers', `${name}.js`);
const index = join(here, '..', 'src', 'index.js');
const api = await import(pathToFileURL(index).href);
const options = { stepTimeoutMs: 2000, totalTimeoutMs: 8000, slowThresholdMs: 10000 };
const target = (name, args = [], env = {}) => ({ transport: 'stdio', command: process.execPath, args: [script(name), ...args], env });
async function probeStdio(name, args = [], env = {}, probeOptions = options) {
  const dir = mkdtempSync(join(root, 'integration-process-'));
  const pidFile = join(dir, 'pid');
  let pid;
  let verifiedGone = false;
  try {
    const report = await api.probe(target(name, args, { ...env, FIXTURE_PID_FILE: pidFile }), probeOptions);
    assert.ok(existsSync(pidFile), `${name} did not record its process ID`);
    pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `${name} must be gone when probe resolves`);
    verifiedGone = true;
    return report;
  } finally {
    if (!pid && existsSync(pidFile)) pid = Number(readFileSync(pidFile, 'utf8'));
    if (pid && !verifiedGone) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
const ids = report => report.findings.map(f => f.id);
const failure = (report, kind) => { assert.equal(report.status, 'FAIL'); assert.equal(report.failure?.kind, kind); };
const hasFinding = (report, id, status) => { assert.equal(report.status, status); assert.ok(ids(report).includes(id), `missing finding ${id}`); };
const textWithout = (report, secret) => {
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.ok(!api.renderMarkdown(report).includes(secret));
};
const run = (name, fn) => test(`probe ${name}`, fn);

run('ok-stdio', async () => {
  const report = await probeStdio('ok-stdio');
  assert.equal(report.status, 'PASS'); assert.equal(report.failure, null);
  assert.equal(report.tools.count, 2); assert.equal(report.tools.pages, 1);
  assert.equal(report.server.name, 'fixture-server'); assert.equal(report.server.instructionsPresent, true);
});
run('ok-http', async () => {
  const token = 'fixture-token-confidential';
  const fixture = await startHttpFixture(script('ok-http'), { FIXTURE_TOKEN: token });
  try {
    const unauth = await api.probe({ transport: 'http', url: fixture.url }, options);
    failure(unauth, 'auth_failed');
    const report = await api.probe({ transport: 'http', url: fixture.url, headers: { Authorization: `Bearer ${token}` } }, options);
    assert.equal(report.status, 'PASS'); assert.equal(report.tools.count, 2); textWithout(report, token);
    textWithout(unauth, token);
  } finally { await fixture.close(); }
});
for (const status of [401, 403]) {
  run(`http-auth ${status}`, async () => {
    const token = 'fixture-token-confidential';
    const fixture = await startHttpFixture(script('http-auth'), { FIXTURE_TOKEN: token, FIXTURE_AUTH_STATUS: String(status) });
    try {
      const denied = await api.probe({ transport: 'http', url: fixture.url, headers: { Authorization: 'Bearer wrong' } }, { ...options, secrets: [token] });
      failure(denied, 'auth_failed'); textWithout(denied, token);
      const accepted = await api.probe({ transport: 'http', url: fixture.url, headers: { Authorization: `Bearer ${token}` } }, { ...options, secrets: [token] });
      assert.equal(accepted.status, 'PASS'); textWithout(accepted, token);
    } finally { await fixture.close(); }
  });
}
for (const name of ['http-bad-json', 'http-wrong-content-type']) {
  run(name, async () => {
    const fixture = await startHttpFixture(script(name));
    try { failure(await api.probe({ transport: 'http', url: fixture.url }, options), 'invalid_response'); }
    finally { await fixture.close(); }
  });
}
run('http-hang', async () => {
  const fixture = await startHttpFixture(script('http-hang'));
  try { failure(await api.probe({ transport: 'http', url: fixture.url }, { ...options, stepTimeoutMs: 400 }), 'timeout'); }
  finally { await fixture.close(); }
});
run('http-500 redacts its error body', async () => {
  const secret = 'fixture-secret-confidential';
  const fixture = await startHttpFixture(script('http-500'), { FIXTURE_SECRET: secret });
  try {
    const report = await api.probe({ transport: 'http', url: fixture.url }, { ...options, secrets: [secret] });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.failure?.kind, 'handshake_failed');
    textWithout(report, secret);
  } finally { await fixture.close(); }
});
run('http-sse', async () => {
  const fixture = await startHttpFixture(script('http-sse'));
  try {
    const report = await api.probe({ transport: 'http', url: fixture.url }, options);
    assert.equal(report.status, 'PASS'); assert.equal(report.tools.count, 2);
  } finally { await fixture.close(); }
});
run('http connection refused', async () => {
  const port = await getFreeClosedPort();
  failure(await api.probe({ transport: 'http', url: `http://127.0.0.1:${port}/mcp` }, options), 'connection_refused');
});
run('handshake-fail', async () => failure(await probeStdio('handshake-fail'), 'handshake_failed'));
run('bad-protocol', async () => {
  const report = await probeStdio('bad-protocol');
  assert.equal(report.status, 'FAIL');
  assert.equal(report.failure?.kind, 'protocol_mismatch');
});
run('dup-tools', async () => hasFinding(await probeStdio('dup-tools'), 'TOOL_NAME_DUPLICATE', 'FAIL'));
run('bad-schema', async () => {
  const report = await probeStdio('bad-schema');
  hasFinding(report, 'TOOL_SCHEMA_NOT_OBJECT', 'FAIL'); assert.ok(ids(report).includes('TOOL_SCHEMA_INVALID'));
});
run('empty-tools', async () => hasFinding(await probeStdio('empty-tools'), 'TOOLS_EMPTY', 'WARNING'));
run('no-description', async () => hasFinding(await probeStdio('no-description'), 'TOOL_DESCRIPTION_MISSING', 'WARNING'));
run('slow', async () => failure(await probeStdio('slow', ['5000'], {}, { ...options, stepTimeoutMs: 800 }), 'timeout'));
run('early-exit', async () => {
  const report = await probeStdio('early-exit');
  failure(report, 'process_exited'); assert.equal(report.failure.exitCode, 3); assert.match(report.failure.stderrTail, /fixture exited early/);
});
run('garbage', async () => {
  const report = await probeStdio('garbage', [], {}, { ...options, stepTimeoutMs: 1000 });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.failure?.kind, 'invalid_response');
});
run('echo-secret', async () => {
  const secret = 'fixture-secret-confidential';
  const report = await probeStdio('echo-secret', [], { FIXTURE_SECRET: secret }, { ...options, secrets: [secret] });
  hasFinding(report, 'SECRET_IN_RESPONSE', 'WARNING'); textWithout(report, secret);
});
run('spawns-child', async () => {
  const dir = mkdtempSync(join(root, 'integration-'));
  const path = join(dir, 'pid');
  let pid;
  try {
    const report = await probeStdio('spawns-child', [path]);
    assert.equal(report.status, 'PASS');
    pid = Number(readFileSync(path, 'utf8')); assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'grandchild must be gone when probe resolves');
  } finally {
    if (!pid && existsSync(path)) pid = Number(readFileSync(path, 'utf8'));
    if (pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else { try { process.kill(pid, 'SIGKILL'); } catch (err) { if (err.code !== 'ESRCH') throw err; } }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
run('paginated', async () => {
  const report = await probeStdio('paginated');
  assert.equal(report.status, 'PASS'); assert.equal(report.tools.count, 3); assert.equal(report.tools.pages, 3);
  const loop = await probeStdio('paginated', ['loop']);
  hasFinding(loop, 'TOOLS_PAGINATION_LOOP', 'FAIL');
});
run('tool-call-tripwire', async () => {
  const dir = mkdtempSync(join(root, 'integration-'));
  const path = join(dir, 'tripwire');
  try {
    const report = await probeStdio('tool-call-tripwire', [path]);
    assert.equal(report.status, 'PASS');
    assert.equal(existsSync(path) ? readFileSync(path, 'utf8') : '', '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
