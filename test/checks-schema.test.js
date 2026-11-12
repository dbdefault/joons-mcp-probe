import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaChecker } from '../src/checks/schema.js';
import { checkTools } from '../src/checks/tools.js';

const compile = createSchemaChecker();
for (const [label, schema, valid] of [
  ['draft 7', { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }, true],
  ['draft 2020', { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', unevaluatedProperties: false }, true],
  ['unknown format', { type: 'object', properties: { x: { type: 'string', format: 'unknown-format' } } }, true],
  ['invalid properties', { type: 'object', properties: 5 }, false],
  ['unresolved reference', { type: 'object', $ref: '#/$defs/nope' }, false],
  ['non-object', 'object', false],
  ['array', [], false],
  ['prototype pollution', JSON.parse('{"type":"object","__proto__":{"polluted":true}}'), false],
]) test(label, () => assert.equal(compile(schema), valid));
test('cyclic and oversized schemas are rejected without throwing', () => {
  const cyclic = { type: 'object' }; cyclic.properties = { cyclic };
  assert.equal(compile(cyclic), false);
  assert.equal(compile({ type: 'object', enum: Array(10001).fill(1) }), false);
  assert.equal({}.polluted, undefined);
});
test('valid and invalid output schemas', () => {
  for (const [schema, valid] of [[{ type: 'object' }, true], [{ type: 'object', properties: 5 }, false], [null, false]]) {
    const result = checkTools([{ name: 'x', description: 'x', inputSchema: { type: 'object' }, outputSchema: schema }]);
    assert.equal(!result.findings.some((x) => x.id === 'TOOL_OUTPUT_SCHEMA_INVALID'), valid);
  }
});
