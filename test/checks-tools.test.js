import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTools } from '../src/checks/tools.js';

const good = (overrides = {}) => ({ name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, ...overrides });
const ids = (tool) => checkTools([tool]).findings.map((finding) => finding.id);

test('valid tool and empty list', () => {
  assert.deepEqual(checkTools([good()]), { items: [{ name: 'echo', hasDescription: true, schemaValid: true }], findings: [] });
  assert.deepEqual(checkTools([]).findings.map((x) => x.id), ['TOOLS_EMPTY']);
});
for (const [label, tool, expected] of [
  ['missing name', good({ name: undefined }), 'TOOL_NAME_MISSING'],
  ['non-string name', good({ name: 42 }), 'TOOL_NAME_MISSING'],
  ['invalid characters', good({ name: 'bad name' }), 'TOOL_NAME_INVALID'],
  ['long name', good({ name: 'x'.repeat(129) }), 'TOOL_NAME_INVALID'],
  ['blank description', good({ description: '  \n' }), 'TOOL_DESCRIPTION_MISSING'],
  ['missing schema', { name: 'x', description: 'x' }, 'TOOL_SCHEMA_MISSING'],
  ['array type', good({ inputSchema: { type: 'array' } }), 'TOOL_SCHEMA_NOT_OBJECT'],
  ['string type', good({ inputSchema: { type: 'string' } }), 'TOOL_SCHEMA_NOT_OBJECT'],
  ['invalid keyword', good({ inputSchema: { type: 'object', properties: 5 } }), 'TOOL_SCHEMA_INVALID'],
  ['missing reference', good({ inputSchema: { type: 'object', $ref: '#/$defs/missing' } }), 'TOOL_SCHEMA_INVALID'],
  ['invalid output', good({ outputSchema: { type: 'string' } }), 'TOOL_OUTPUT_SCHEMA_INVALID'],
  ['invalid output keyword', good({ outputSchema: { type: 'object', properties: 5 } }), 'TOOL_OUTPUT_SCHEMA_INVALID'],
]) test(label, () => assert.ok(ids(tool).includes(expected)));

test('duplicates are reported for each occurrence after the first', () => {
  assert.equal(checkTools([good(), good(), good()]).findings.filter((x) => x.id === 'TOOL_NAME_DUPLICATE').length, 2);
});
test('finding messages do not reproduce hostile text', () => {
  const result = checkTools([good({ name: 'x'.repeat(1000), description: '' })]);
  assert.ok(result.findings.every((x) => x.message.length <= 120));
});
test('one thousand tools finish within 500 ms', () => {
  const tools = Array.from({ length: 1000 }, (_, i) => good({ name: `tool${i}` }));
  const start = performance.now();
  const result = checkTools(tools);
  assert.equal(result.findings.length, 0);
  assert.ok(performance.now() - start < 500);
});
