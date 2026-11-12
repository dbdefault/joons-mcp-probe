import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { probe, redact, renderJson, renderMarkdown, checkTools } from '../src/index.js';
import { createSchemaChecker } from '../src/checks/schema.js';
import { resolveStdioCommand } from '../src/commands.js';
import { parseArgs } from '../src/args.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const server=fileURLToPath(new URL('./core-fixtures/robust.js',import.meta.url));
const bin=fileURLToPath(new URL('../bin/joons-mcp-probe.js',import.meta.url));
const target=mode=>({transport:'stdio',command:process.execPath,args:[server,mode]});
const forms=s=>[s,encodeURIComponent(s),Buffer.from(s).toString('base64'),Buffer.from(s).toString('base64url'),Buffer.from(`Bearer ${s}`).toString('base64'),Buffer.from(`Bearer ${s}`).toString('base64url'),Buffer.from(`user:${s}`).toString('base64'),Buffer.from(`user:${s}`).toString('base64url')];
const secret='fake token/?+£-confidential';
function execute(script,args,env={}){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script,...args],{env:{...process.env,...env},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('subprocess deadline'));},20000);
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);
  child.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});
});}
test('credential variants mask free-text values, bearer components and Basic credentials',()=>{
  for(const s of ['Q','QZ','QZX',secret])for(const form of forms(s))assert.equal(redact(form,[s]),'***',form);
  assert.equal(redact('echo only-token', ['Bearer only-token']),'echo ***');
  assert.equal(redact('echo only-token',['Basic '+Buffer.from('custom:only-token').toString('base64')]),'echo ***');
  assert.equal(redact('abc+def abc%20def',['abc def']),'*** ***');
});
for(const mode of ['encoded','encoded-error'])test(`library masks encoded credentials in ${mode}`,async()=>{
  const r=await probe({...target(mode),env:{FIXTURE_SECRET:secret}});
  assert.ok(r.findings.some(f=>f.id==='SECRET_IN_RESPONSE'));
  for(const output of [JSON.stringify(r),renderJson(r),renderMarkdown(r)])for(const s of forms(secret))assert.ok(!output.includes(s),s);
  if(mode==='encoded-error'){assert.equal(r.failure.kind,'handshake_failed');assert.match(r.failure.stderrTail,/\*\*\*/);}
});
test('encoded credentials are absent from real CLI stdout, stderr and both output files',async()=>{
  const dir=await mkdtemp(join(root,'encoded-'));
  try{for(const mode of ['encoded','encoded-error'])for(const format of ['json','markdown']){
    const json=join(dir,'report.json'),md=join(dir,'report.md');
    const r=await execute(bin,['stdio','--env','FIXTURE_SECRET','--format',format,'--json-out',json,'--md-out',md,'--',process.execPath,server,mode],{FIXTURE_SECRET:secret});
    assert.equal(r.code,mode==='encoded'?0:2,r.err);assert.equal(r.err,'');
    for(const output of [r.out,r.err,await readFile(json,'utf8'),await readFile(md,'utf8')])for(const s of forms(secret))assert.ok(!output.includes(s),s);
  }}finally{await rm(dir,{recursive:true,force:true});}
});
test('Authorization component and raw encoded query echoes are masked on HTTP errors',async()=>{
  const http=createServer((req,res)=>{res.writeHead(500,{'Content-Type':'text/plain'});res.end(`${req.url} ${forms(secret).join(' ')} ${req.headers.authorization??''}`);});
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  try{const url=`http://127.0.0.1:${http.address().port}/mcp?token=${encodeURIComponent(secret)}`;
    for(const header of [`Bearer ${secret}`,`Basic ${Buffer.from(`user:${secret}`).toString('base64')}`]){
      const r=await probe({transport:'http',url,headers:{Authorization:header}});assert.equal(r.failure.kind,'handshake_failed');
      for(const output of [JSON.stringify(r),renderJson(r),renderMarkdown(r)])for(const s of forms(secret))assert.ok(!output.includes(s),s);
      for(const format of ['json','markdown']){
        const cli=await execute(bin,['http',url,'--header','Authorization=TOKEN','--format',format],{TOKEN:header});
        assert.equal(cli.code,2,cli.err);for(const s of forms(secret))assert.ok(!cli.out.includes(s),s);assert.equal(cli.err,'');
      }
    }
  }finally{await new Promise(resolve=>http.close(resolve));}
});
test('150000 tool entries hit maxTools rather than the JS argument limit',async()=>{
  const r=await probe(target('tools150k'));
  assert.equal(r.failure,null);assert.equal(r.tools.count,10000);assert.ok(r.findings.some(f=>f.id==='TOOLS_LIMIT_EXCEEDED'));
  assert.ok(!JSON.stringify(r).includes('Maximum call stack'));
});
test('cooperative budget is checked between schema compilations',()=>{
  let elapsed=0;
  const result=checkTools(Array.from({length:100},(_,i)=>({name:`t${i}`,description:'d',inputSchema:{type:'object',properties:{[`p${i}`]:{type:'string'}}}})),{deadline:8,now:()=>elapsed++});
  assert.equal(result.budgetExceeded,true);assert.ok(result.items.length<100);assert.ok(result.findings.some(f=>f.id==='CHECKS_BUDGET_EXCEEDED'));
  let calls=0;const compile=createSchemaChecker({checkBudget:()=>{if(++calls===3)throw Object.assign(new Error('budget'),{code:'CHECKS_BUDGET_EXCEEDED'});}});
  assert.throws(()=>compile({type:'object'}),{code:'CHECKS_BUDGET_EXCEEDED'});
});
test('distinct schema CPU load respects step and total deadlines',async()=>{
  const begin=performance.now();const r=await probe(target('slowcpu'),{maxTools:20000,maxResponseBytes:8*1024*1024,stepTimeoutMs:700,totalTimeoutMs:1000,closeTimeoutMs:1500});
  assert.ok(r.findings.some(f=>f.id==='CHECKS_BUDGET_EXCEEDED'));assert.ok(r.findings.some(f=>f.id==='SLOW_STEP'));
  assert.equal(r.failure?.kind,'timeout');assert.ok(performance.now()-begin<3500);
});
test('Windows direct and PATHEXT batch targets are usage errors, with explicit cmd opt-in', {skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(root,'batch-'));
  try{await writeFile(join(dir,'probe-batch'),'#!/bin/sh\necho MUST_NOT_RUN\n');for(const extension of ['cmd','bat']){
    const file=join(dir,`probe-batch.${extension}`);await writeFile(file,'@echo MUST_NOT_RUN\r\n');
    assert.throws(()=>resolveStdioCommand({command:file}),/require a shell/);
    await assert.rejects(probe({transport:'stdio',command:file,args:[]}),TypeError);
    const direct=await execute(bin,['stdio','--',file]);assert.equal(direct.code,3);assert.match(direct.err,/require a shell/);
    assert.throws(()=>parseArgs(['stdio','--env','PATH','--env','PATHEXT','--','probe-batch'],{PATH:dir,PATHEXT:`.${extension}`}),/require a shell/);
    const cli=await execute(bin,['stdio','--','probe-batch'],{PATH:dir,PATHEXT:`.${extension}`});assert.equal(cli.code,3);assert.match(cli.err,/cmd.exe \/d \/s \/c/);assert.doesNotMatch(cli.out,/MUST_NOT_RUN/);
  }
  assert.doesNotThrow(()=>parseArgs(['stdio','--','cmd.exe','/d','/s','/c','chosen.cmd']));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('SDK handshake plus rejected cleanup still yields a report without unhandled rejection',async()=>{
  const fixture=fileURLToPath(new URL('./core-fixtures/server.js',import.meta.url));
  const driver=fileURLToPath(new URL('./core-fixtures/reject-close.js',import.meta.url));
  for(const mode of ['handshake','version']){
    const r=await execute(driver,[fixture,mode]);assert.equal(r.code,2,r.err);assert.equal(r.err,'');
    assert.equal(JSON.parse(r.out).failure.kind,mode==='handshake'?'handshake_failed':'protocol_mismatch');
  }
});
const dangerous=/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
test('bidi, C0/C1 and ANSI controls are inert in Markdown, JSON and CLI stdout',async()=>{
  for(const mode of ['controls','controls-error']){
    const r=await probe(target(mode));assert.equal(r.failure?.kind,mode==='controls'?undefined:'handshake_failed');
    assert.doesNotMatch(renderMarkdown(r),dangerous);assert.doesNotMatch(renderMarkdown(r),/\[31m|\]0;title/);
    const json=renderJson(r);assert.doesNotMatch(json,dangerous);
    assert.equal(JSON.parse(json).server?.name??JSON.parse(json).failure.message,r.server?.name??r.failure.message);
    for(const format of ['json','markdown']){const cli=await execute(bin,['stdio','--format',format,'--',process.execPath,server,mode]);assert.equal(cli.code,mode==='controls'?0:2,cli.err);assert.doesNotMatch(cli.out,dangerous);assert.equal(cli.err,'');}
  }
});
