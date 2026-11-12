import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactUrl, maskHeaders } from '../src/redact.js';
test('generic untrusted data redacts keys and values without mutation', () => {
  const input = { 'key-secret123': ['secret123 secret123', { x: 'tiny' }] };
  assert.deepEqual(redact(input, ['secret123', 'tiny', 'no']), { 'key-***': ['*** ***', { x: '***' }] });
  assert.equal(input['key-secret123'][0], 'secret123 secret123');
});
test('URL removes credentials and every query value', () => {
  const result = new URL(redactUrl('https://user:pass@example.com/path?a=one&a=two&b='));
  assert.equal(result.username, ''); assert.equal(result.password, '');
  assert.deepEqual([...result.searchParams.values()], ['***', '***', '***']);
  assert.equal(redactUrl('not a url'), '[invalid URL]');
});
test('sensitive headers are masked case-insensitively', () => {
  assert.deepEqual(maskHeaders({ Authorization: 'a', Cookie: 'b', 'Set-Cookie': 'c', 'X-Api-Key': 'd', 'x-custom-token': 'e', Accept: 'json' }), { Authorization: '***', Cookie: '***', 'Set-Cookie': '***', 'X-Api-Key': '***', 'x-custom-token': '***', Accept: 'json' });
});
