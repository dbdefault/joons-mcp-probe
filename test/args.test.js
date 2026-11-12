import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError } from '../src/args.js';

test('stdio preserves argv after separator without splitting shell strings', () => {
  assert.deepEqual(parseArgs(['stdio', '--', 'node', 'server.js', '--flag'], {}).target, { transport: 'stdio', command: 'node', args: ['server.js', '--flag'] });
  assert.deepEqual(parseArgs(['stdio', '--', 'node server.js --flag'], {}).target, { transport: 'stdio', command: 'node server.js --flag', args: [] });
});
test('only selected env values are passed and registered as secrets', () => {
  const p = parseArgs(['stdio', '--env', 'A', '--', 'node'], { A: 'secret', B: 'private' });
  assert.deepEqual(p.target.env, { A: 'secret' }); assert.deepEqual(p.options.secrets, ['secret']);
});
test('header resolves env and missing variable fails', () => {
  const p = parseArgs(['http', 'https://example.test', '--header', 'Authorization=TOKEN'], { TOKEN: 'secret' });
  assert.equal(p.target.headers.Authorization, 'secret'); assert.ok(p.options.secrets.includes('secret'));
  assert.throws(() => parseArgs(['http', 'https://example.test', '--header', 'Authorization=TOKEN'], {}), UsageError);
});
test('invalid flags and values are usage errors', () => {
  for (const args of [['--bad'], ['stdio', '--slow', '0', '--', 'node'], ['http', 'oops'], ['stdio', 'node']]) assert.throws(() => parseArgs(args, {}), UsageError);
});
