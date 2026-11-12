import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { probe, renderJson, renderMarkdown, redact, checkTools } from '../src/index.js';
import { response } from './core-fixtures/bounded-input.js';
const fixture=fileURLToPath(new URL('./core-fixtures/bounded-input.js',import.meta.url));
function verify(r){
  assert.equal(r.failure,null);assert.equal(r.status,'WARNING');
  assert.ok(r.findings.some(f=>f.id==='RESPONSE_TOO_DEEP'&&f.severity==='warning'));
  assert.match(renderJson(r),/\[depth limit\]/);assert.match(renderMarkdown(r),/RESPONSE_TOO_DEEP/);
}
test('10,000-level stdio data resolves to a bounded warning report',async()=>{
  verify(await probe({transport:'stdio',command:process.execPath,args:[fixture,'deep']}));
});
test('10,000-level HTTP data resolves to a bounded warning report',async()=>{
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    let body='';for await(const chunk of req)body+=chunk;
    const result=response(JSON.parse(body));
    if(result)res.writeHead(200,{'content-type':'application/json'}).end(result);else res.writeHead(202).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{verify(await probe({transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`}));}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('direct sanitizers, renderers and schema checks bound deeply nested graphs',()=>{
  const data={};let cursor=data;for(let i=0;i<10000;i++)cursor=cursor.x={};
  assert.doesNotThrow(()=>redact(data,['x']));
  const report={schemaVersion:1,status:'PASS',server:{capabilities:data},findings:[],tools:null,failure:null};
  assert.match(renderJson(report),/RESPONSE_TOO_DEEP/);assert.match(renderMarkdown(report),/RESPONSE_TOO_DEEP/);
  assert.doesNotThrow(()=>checkTools([{name:'deep',description:'deep',inputSchema:{type:'object',properties:data}}]));
});
