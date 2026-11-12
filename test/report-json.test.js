import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJson } from '../src/report/json.js';
test('contract order and pretty JSON remain stable', () => {
  const report = { status: 'PASS', target: { url: 'https://u:p@example.com/?a=secret', transport: 'http' }, tool: { version: '0.1.0', name: 'joons-mcp-probe' }, schemaVersion: 1, findings: [{ message: 'ok', category: 'tools', severity: 'info', id: 'X' }], failure: null };
  const result = renderJson(report); const parsed = JSON.parse(result);
  assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'tool', 'target', 'status', 'findings', 'failure']);
  assert.deepEqual(Object.keys(parsed.findings[0]), ['id', 'severity', 'category', 'message']);
  assert.match(result, /\n  "tool"/); assert.doesNotMatch(result, /secret|u:p/);
});
