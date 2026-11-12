import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startHttpFixture } from './fixtures/run-http.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const script = name => join(root, 'servers', `${name}.js`);
const init = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1.0.0' } };

function driver(name, args = [], env = {}) {
  const child = spawn(process.execPath, [script(name), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const queue = [];
  let wake;
  lines.on('line', line => { queue.push(line); wake?.(); });
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let id = 0;
  return {
    child, exited,
    async line() {
      const deadline = Date.now() + 10000;
      while (!queue.length) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('Fixture response timed out');
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { wake = undefined; reject(new Error('Fixture response timed out')); }, left);
          wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
      }
      return queue.shift();
    },
    async request(method, params = {}) {
      const requestId = ++id;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
      const response = JSON.parse(await this.line());
      assert.equal(response.id, requestId);
      return response;
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2000);
      try { await exited; } finally { clearTimeout(timer); lines.close(); }
    }
  };
}
function killPid(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}

for (const name of ['ok-stdio', 'handshake-fail', 'bad-protocol', 'dup-tools', 'bad-schema', 'empty-tools', 'no-description', 'slow', 'echo-secret', 'spawns-child', 'paginated', 'tool-call-tripwire']) {
  test(`fixture ${name}`, async () => {
    const dir = mkdtempSync(join(root, 'selftest-'));
    const path = join(dir, 'record');
    const args = name === 'slow' ? ['20'] : ['spawns-child', 'tool-call-tripwire'].includes(name) ? [path] : [];
    const d = driver(name, args, { FIXTURE_SECRET: 'fixture-secret-value' });
    let pid;
    try {
      const response = await d.request('initialize', init);
      if (name === 'handshake-fail') { assert.equal(response.error.code, -32603); return; }
      assert.equal(response.result.protocolVersion, name === 'bad-protocol' ? '1999-01-01' : init.protocolVersion);
      assert.equal(response.result.serverInfo.name, 'fixture-server');
      if (name === 'spawns-child') { pid = Number(readFileSync(path, 'utf8')); assert.ok(pid > 0); process.kill(pid, 0); }
      const list = (await d.request('tools/list')).result;
      if (name === 'ok-stdio') { assert.equal(list.tools.length, 2); assert.ok(response.result.instructions); }
      if (name === 'dup-tools') assert.equal(list.tools[0].name, list.tools[1].name);
      if (name === 'bad-schema') { assert.equal(list.tools[0].inputSchema.type, 'string'); assert.equal(list.tools[1].inputSchema.properties, 5); }
      if (name === 'empty-tools') assert.equal(list.tools.length, 0);
      if (name === 'no-description') assert.equal(list.tools[0].description, undefined);
      if (name === 'echo-secret') assert.equal(list.tools[0].description, 'fixture-secret-value');
      if (name === 'paginated') {
        assert.equal(list.nextCursor, 'page-2');
        const second = (await d.request('tools/list', { cursor: list.nextCursor })).result;
        assert.equal(second.nextCursor, 'page-3');
        const third = (await d.request('tools/list', { cursor: second.nextCursor })).result;
        assert.equal(third.nextCursor, undefined);
        assert.deepEqual([list.tools[0].name, second.tools[0].name, third.tools[0].name], ['page_1', 'page_2', 'page_3']);
      }
      if (name === 'tool-call-tripwire') { await d.request('tools/call'); assert.equal(readFileSync(path, 'utf8'), 'tools/call\n'); }
    } finally {
      await d.close();
      if (pid) killPid(pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('fixture paginated loop repeats its cursor', async () => {
  const d = driver('paginated', ['loop']);
  try {
    await d.request('initialize', init);
    const first = (await d.request('tools/list')).result;
    const second = (await d.request('tools/list', { cursor: first.nextCursor })).result;
    assert.equal(second.nextCursor, first.nextCursor);
  } finally { await d.close(); }
});

test('fixture can record its process ID and exits on stdin close', async () => {
  const dir = mkdtempSync(join(root, 'selftest-process-'));
  const path = join(dir, 'pid');
  const d = driver('ok-stdio', [], { FIXTURE_PID_FILE: path });
  try {
    await d.request('initialize', init);
    assert.equal(Number(readFileSync(path, 'utf8')), d.child.pid);
  } finally {
    await d.close();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => process.kill(d.child.pid, 0), { code: 'ESRCH' });
});

test('fixture early-exit emits stderr and exit code 3', async () => {
  const d = driver('early-exit');
  let stderr = '';
  d.child.stderr.on('data', chunk => { stderr += chunk; });
  const result = await d.exited;
  assert.equal(result.code, 3);
  assert.match(stderr, /fixture exited early/);
});

test('fixture garbage emits non-JSON', async () => {
  const d = driver('garbage');
  try { assert.throws(() => JSON.parse('this is not JSON')); assert.equal(await d.line(), 'this is not JSON'); }
  finally { await d.close(); }
});

test('fixture ok-http supports streamable HTTP and bearer authentication', async () => {
  const token = 'fixture-http-token';
  const fixture = await startHttpFixture(script('ok-http'), { FIXTURE_TOKEN: token });
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: init });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    assert.equal((await fetch(fixture.url, { method: 'POST', headers, body })).status, 401);
    const response = await fetch(fixture.url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}` }, body });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.serverInfo.name, 'fixture-server');
    const list = await fetch(fixture.url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}`, 'mcp-protocol-version': init.protocolVersion, 'mcp-session-id': response.headers.get('mcp-session-id') }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    assert.equal((await list.json()).result.tools.length, 2);
  } finally { await fixture.close(); }
});
