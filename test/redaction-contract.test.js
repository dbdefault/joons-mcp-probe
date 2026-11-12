import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, renderJson, renderMarkdown, redact } from '../src/index.js';
import { redactReport } from '../src/redact.js';
import { main } from '../src/cli.js';
const secrets=['A','S','ok','FAIL','status','1','2025'];
const root=fileURLToPath(new URL('.',import.meta.url));
const server=fileURLToPath(new URL('./core-fixtures/contract-values.js',import.meta.url));
const duplicate=fileURLToPath(new URL('./fixtures/servers/dup-tools.js',import.meta.url));
const bin=fileURLToPath(new URL('../bin/joons-mcp-probe.js',import.meta.url));
const rootKeys=['schemaVersion','tool','startedAt','finishedAt','target','status','server','timings','tools','findings','failure'];
function shape(report){
  assert.deepEqual(Object.keys(report),rootKeys);
  assert.equal(report.schemaVersion,1);assert.deepEqual(report.tool,{name:'joons-mcp-probe',version:'0.1.0'});
  assert.ok(['PASS','WARNING','FAIL'].includes(report.status));
  for(const k of ['startedAt','finishedAt']){assert.match(report[k],/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);assert.ok(Number.isFinite(Date.parse(report[k])));}
  assert.deepEqual(Object.keys(report.timings),['connectMs','initializeMs','toolsListMs','totalMs']);
  for(const value of Object.values(report.timings))assert.ok(value===null||Number.isInteger(value));
  if(report.server){assert.deepEqual(Object.keys(report.server),['name','version','protocolVersion','capabilities','instructionsPresent']);assert.equal(report.server.protocolVersion,'2025-11-25');assert.equal(typeof report.server.instructionsPresent,'boolean');}
  const expected=report.failure||report.findings.some(f=>f.severity==='fail')?'FAIL':report.findings.some(f=>f.severity==='warning')?'WARNING':'PASS';
  assert.equal(report.status,expected);
  for(const f of report.findings){assert.match(f.id,/^[A-Z_]+$/);assert.ok(['fail','warning','info'].includes(f.severity));assert.ok(['connection','protocol','tools','schema','performance','security'].includes(f.category));}
}
function sample(secret){return{schemaVersion:1,tool:{name:'joons-mcp-probe',version:'0.1.0'},startedAt:'2025-01-01T00:00:00.001Z',finishedAt:'2025-01-01T00:00:00.002Z',target:{transport:'stdio',command:`before ${secret} after`,args:[secret]},status:'FAIL',server:{name:secret,version:secret,protocolVersion:'2025-11-25',capabilities:{status:secret,feature:true,numeric:1},instructionsPresent:true,instructions:secret},timings:{connectMs:1,initializeMs:1,toolsListMs:1,totalMs:3},tools:{count:1,pages:1,items:[{name:secret,description:secret,hasDescription:true,schemaValid:false}]},findings:[{id:'TOOL_NAME_DUPLICATE',severity:'fail',category:'tools',message:secret,tool:secret}],failure:{kind:'handshake_failed',step:'initialize',message:secret,exitCode:1,stderrTail:secret}};}
test('schema-path redaction preserves controlled fields/keys while masking untrusted capability keys',()=>{
  for(const secret of [...secrets,'"','}',':']){
    const original=sample(secret),r=redactReport(original,[secret]);
    assert.equal(r.status,'FAIL');assert.deepEqual(r.tool,original.tool);assert.deepEqual(r.timings,original.timings);
    assert.equal(r.startedAt,original.startedAt);assert.equal(r.finishedAt,original.finishedAt);assert.equal(r.server.protocolVersion,original.server.protocolVersion);
    const capKey=secret==='status'?'***':'status';
    assert.deepEqual(Object.keys(r.server.capabilities),[capKey,'feature','numeric']);assert.equal(r.server.capabilities[capKey],'***');
    assert.equal(r.server.capabilities.feature,true);assert.equal(r.server.capabilities.numeric,1);assert.equal(r.server.instructions,'***');
    assert.equal(r.server.name,'***');assert.equal(r.server.version,'***');assert.equal(r.target.command,'before *** after');assert.deepEqual(r.target.args,['***']);
    assert.equal(r.tools.count,1);assert.equal(r.tools.items[0].name,'***');assert.equal(r.tools.items[0].description,'***');assert.equal(r.tools.items[0].schemaValid,false);
    assert.deepEqual(r.findings[0],{id:'TOOL_NAME_DUPLICATE',severity:'fail',category:'tools',message:'***',tool:'***'});
    assert.deepEqual(r.failure,{kind:'handshake_failed',step:'initialize',message:'***',exitCode:1,stderrTail:'***'});
    assert.equal(original.failure.message,secret);assert.equal(JSON.parse(renderJson(r)).status,'FAIL');
    assert.match(renderMarkdown(r),/# MCP Probe: FAIL/);assert.match(renderMarkdown(r),/TOOL_NAME_DUPLICATE/);
    assert.equal(redact(original,[secret]).status,'FAIL');
  }
  const unsupported=sample('2025');unsupported.server.protocolVersion='unknown-2025-version';assert.equal(redactReport(unsupported,['2025']).server.protocolVersion,'unknown-***-version');
});
test('every nonempty secret is masked as a substring, including short literals and encoded forms',()=>{
  assert.equal(redact('prefixabsuffix',['ab']),'prefix***suffix');
  assert.equal(redact('A_A xAx A',['A']),'***_*** x***x ***');
  assert.equal(redact('QQ== xQQ==y',['A']),'*** x***y');
  assert.deepEqual(redact({status:'status',A:'A'},['status','A']),{'***':'***'});
});
test('library reports retain schema/status while free-text echoes are masked',async()=>{
  for(const secret of secrets){
    const r=await probe({transport:'stdio',command:process.execPath,args:[server],env:{S1X:secret}});shape(r);assert.equal(r.status,'FAIL');
    assert.equal(r.server.name,'before *** after');assert.equal(r.server.version,'***');assert.ok(r.tools.items.every(t=>t.name==='***'));
    assert.ok(r.findings.some(f=>f.id==='TOOL_NAME_DUPLICATE'&&f.severity==='fail'&&f.tool==='***'));
    const failure=await probe({transport:'stdio',command:process.execPath,args:[server,'error'],env:{S1X:secret}});shape(failure);
    assert.equal(failure.failure.kind,'handshake_failed');assert.equal(failure.failure.step,'initialize');assert.match(failure.failure.message,/before \*\*\* after/);assert.equal(failure.failure.stderrTail,'before *** after');
  }
});
test('embedded short secrets and capability keys are masked in library and real CLI JSON/Markdown files',async()=>{
  const fixture=fileURLToPath(new URL('./core-fixtures/bounded-input.js',import.meta.url));
  const dir=await mkdtemp(join(root,'embedded-'));
  try{for(const secret of ['ab','abc','fake-long-token','A','1']){
    const r=await probe({transport:'stdio',command:process.execPath,args:[fixture,'echo'],env:{S1X:secret}});
    shape(r);assert.equal(r.server.name,'prefix***suffix');
    assert.deepEqual(r.server.capabilities.experimental,{'key-***-end':{value:'prefix***suffix'}});
    assert.ok(r.findings.some(f=>f.id==='SECRET_IN_RESPONSE'));
    for(const format of ['json','markdown']){
      const json=join(dir,'r.json'),md=join(dir,'r.md');
      const result=await cli(['stdio','--env','S1X','--format',format,'--json-out',json,'--md-out',md,'--',process.execPath,fixture,'echo'],secret);
      assert.equal(result.code,0,result.err);assert.equal(result.err,'');
      const stored=JSON.parse(await readFile(json,'utf8'));shape(stored);assert.equal(stored.server.name,'prefix***suffix');
      assert.deepEqual(stored.server.capabilities.experimental,{'key-***-end':{value:'prefix***suffix'}});
      for(const text of [result.out,await readFile(md,'utf8')]){
        assert.ok(!text.includes(`prefix${secret}suffix`));assert.ok(!text.includes(`key-${secret}-end`));
      }
    }
  }}finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI calculates the full exit matrix before renderers or redaction can change a report',async()=>{
  for(const secret of secrets)for(const [status,failOn,expected]of[['PASS','fail',0],['WARNING','fail',0],['WARNING','warning',1],['FAIL','fail',2]]){
    const report=sample(secret);report.status=status;let out='';const result=await main(['stdio','--env','S1X','--fail-on',failOn,'--format','json','--','node'],{env:{S1X:secret},stdout:{write:s=>out+=s},stderr:{write(){}}},{probe:async()=>report,renderJson:r=>{assert.equal(r.status,status);r.status='PASS';return JSON.stringify(r);}});
    assert.equal(result,expected);assert.ok(out);assert.equal(report.status,status);
  }
});
function cli(args,secret){return new Promise((resolve,reject)=>{
  const c=spawn(process.execPath,[bin,...args],{shell:false,windowsHide:true,env:{...process.env,S1X:secret},stdio:['ignore','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>{c.kill('SIGKILL');reject(new Error('CLI deadline'));},15000);c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.once('error',reject);c.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});
});}
test('real NEW-1 reproduction and free-text echoes retain FAIL/exit 2 in stdout and report files',async()=>{
  const dir=await mkdtemp(join(root,'contract-'));
  try{for(const secret of secrets)for(const file of [duplicate,server]){
    const json=join(dir,'r.json'),md=join(dir,'r.md');
    const result=await cli(['stdio','--env','S1X','--format','json','--json-out',json,'--md-out',md,'--',process.execPath,file],secret);
    assert.equal(result.code,2,result.err);assert.equal(result.err,'');const report=JSON.parse(result.out);shape(report);assert.equal(report.status,'FAIL');
    assert.deepEqual(JSON.parse(await readFile(json,'utf8')),report);assert.match(await readFile(md,'utf8'),/# MCP Probe: FAIL/);
    if(file===server){assert.equal(report.server.name,'before *** after');assert.equal(report.tools.items[0].name,'***');}
  }}finally{await rm(dir,{recursive:true,force:true});}
});
