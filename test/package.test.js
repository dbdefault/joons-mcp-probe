import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPackage } from '../scripts/verify-package.js';
test('offline archive includes README links, docs, examples and a working public entry/CLI',async()=>{
  const result=await verifyPackage();assert.equal(result.exampleStatus,'PASS');assert.equal(result.version,'0.1.0');assert.ok(result.entries>10);
});
