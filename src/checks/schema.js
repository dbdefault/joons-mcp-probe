import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { MAX_DATA_DEPTH } from '../bounded.js';

const options = { strict: false, allErrors: true, validateFormats: false };
const draft7 = new Ajv(options);
const draft2020 = new Ajv2020(options);

// Copy only bounded JSON data; do not invoke accessors or pass dangerous keys to Ajv.
function safeCopy(root, checkBudget) {
  const active = new WeakSet();
  let count = 0;
  function copy(value, depth) {
    if (++count > 10000 || depth >= MAX_DATA_DEPTH) throw new Error('Schema exceeds limits');
    if (count % 128 === 0) checkBudget();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || active.has(value)) throw new Error('Not JSON');
    active.add(value);
    const result = Array.isArray(value) ? [] : Object.create(null);
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Unsafe key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('Accessor');
      result[key] = copy(descriptor.value, depth + 1);
    }
    active.delete(value);
    return result;
  }
  return copy(root, 0);
}

// A per-check cache avoids recompiling identical schemas without retaining server data.
export function createSchemaChecker({ checkBudget = () => {} } = {}) {
  const cache = new Map();
  return function schemaCompiles(schema) {
    try {
      checkBudget();
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
      const clean = safeCopy(schema, checkBudget);
      const key = JSON.stringify(clean);
      if (key.length > 1000000) return false;
      checkBudget();
      if (cache.has(key)) return cache.get(key);
      const dialect = typeof clean.$schema === 'string' && /2020-12/.test(clean.$schema) ? draft2020 : draft7;
      // Ajv caches object identities and $id values; remove each schema after compilation.
      let valid = false;
      try { dialect.compile(clean); valid = true; } finally { dialect.removeSchema(clean); }
      checkBudget();
      cache.set(key, valid);
      return valid;
    } catch (error) {
      if (error.code === 'CHECKS_BUDGET_EXCEEDED') throw error;
      return false;
    }
  };
}
