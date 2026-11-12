import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/diagnose.js';
test('nested network cause and explicit failure precedence', () => {
  assert.equal(diagnose(new Error('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) }), 'initialize').kind, 'connection_refused');
  assert.equal(diagnose(Object.assign(new Error(), { kind: 'timeout' }), 'tools_list', { exited:true }).kind, 'timeout');
});
