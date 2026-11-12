import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { Writable } from 'node:stream';

function harness(env = {}) {
  let out = '', err = '';
  return { io: { env, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } }, get out() { return out; }, get err() { return err; } };
}
const fake = status => ({ probe: async () => ({ status }), renderJson: r => JSON.stringify(r), renderMarkdown: r => r.status });
test('exit codes follow status and fail-on', async () => {
  for (const [status, extra, expected] of [['PASS', [], 0], ['WARNING', [], 0], ['WARNING', ['--fail-on', 'warning'], 1], ['FAIL', [], 2]]) {
    const h = harness(); assert.equal(await main(['stdio', ...extra, '--', 'node'], h.io, fake(status)), expected);
  }
});
test('stdout EPIPE and report file errors are output errors (4)', async () => {
  const broken = new Writable({ write(chunk, encoding, callback) { callback(Object.assign(new Error('closed'), {code:'EPIPE'})); } });
  assert.equal(await main(['--version'],{env:{},stdout:broken,stderr:{write(){}}}),4);
  const h=harness();
  assert.equal(await main(['stdio','--json-out',new URL('../test/nonexistent/report.json',import.meta.url).pathname,'--','node'],h.io,fake('PASS')),4);
});
test('usage errors including missing header and unknown option return 3', async () => {
  for (const args of [['--unknown'], ['http', 'https://example.test', '--header', 'Authorization=TOKEN']]) { const h = harness(); assert.equal(await main(args, h.io, fake('PASS')), 3); assert.ok(h.err); }
});
test('help includes all flags and version prints', async () => {
  const h = harness(); assert.equal(await main(['--help'], h.io), 0);
  for (const flag of ['cwd', 'env', 'header', 'step-timeout', 'total-timeout', 'slow', 'format', 'json-out', 'md-out', 'fail-on', 'quiet', 'help', 'version']) assert.ok(h.out.includes(`--${flag}`));
  const v = harness(); assert.equal(await main(['--version'], v.io), 0); assert.equal(v.out, '0.1.0\n');
});
test('secrets are masked in output files and errors; quiet suppresses stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-cli-'));
  try {
    const json = join(dir, 'report.json'), md = join(dir, 'report.md');
    const h = harness({ TOKEN: 'hidden-token' });
    const deps = { probe: async (target, options) => { assert.deepEqual(options.secrets, ['hidden-token']); return { status: 'PASS', text: target.headers.Authorization }; }, renderJson: r => JSON.stringify(r), renderMarkdown: r => r.text };
    assert.equal(await main(['http', 'https://example.test', '--header', 'Authorization=TOKEN', '--quiet', '--json-out', json, '--md-out', md], h.io, deps), 0);
    assert.equal(h.out, ''); assert.ok(!(await readFile(json, 'utf8')).includes('hidden-token')); assert.ok(!(await readFile(md, 'utf8')).includes('hidden-token'));
    const e = harness({ TOKEN: 'hidden-token' });
    assert.equal(await main(['http', 'https://example.test', '--header', 'Authorization=TOKEN'], e.io, { ...deps, probe: async () => { throw Error('hidden-token'); } }), 3);
    assert.ok(!e.err.includes('hidden-token'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
