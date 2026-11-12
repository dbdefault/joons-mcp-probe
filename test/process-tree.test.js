import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from '../src/index.js';
import { createTransport, runCleanupCommand } from '../src/transports.js';
const fixture=fileURLToPath(new URL('./core-fixtures/server.js',import.meta.url));
const root=fileURLToPath(new URL('.',import.meta.url));
test('normal, error, timeout and parent-exited paths clean descendants', async () => {
  const dir=await mkdtemp(join(root,'tree-'));
  try {
    for (const mode of ['tree','tree-error','tree-hang','tree-exit']) {
      const path=join(dir,mode);
      const r=await probe({transport:'stdio',command:process.execPath,args:[fixture,mode,path]},{stepTimeoutMs:500});
      const pids=JSON.parse(await readFile(path,'utf8'));
      for(const pid of Object.values(pids)) assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},`${mode}: PID ${pid}`);
      assert.equal(r.failure?.kind, mode==='tree'?undefined:mode==='tree-error'?'handshake_failed':mode==='tree-exit'?'process_exited':'timeout');
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('failed taskkill falls back and verifies recorded descendants', {skip:process.platform!=='win32'}, async () => {
  const s=createTransport({transport:'stdio',command:process.execPath,args:[fixture,'tree']},65536,{
    runCommand:(file,args,timeout)=>file==='taskkill'?Promise.resolve({code:1,text:'taskkill denied'}):runCleanupCommand(file,args,timeout)
  });
  await s.transport.start();
  while(!s.state.stderrTail.includes('descendant:')) await new Promise(resolve=>setTimeout(resolve,20));
  const descendant=Number(/descendant:(\d+)/.exec(s.state.stderrTail)[1]);
  await s.close(); assert.ok(s.state.descendants.includes(descendant));
  assert.throws(()=>process.kill(descendant,0),{code:'ESRCH'});assert.throws(()=>process.kill(s.state.pid,0),{code:'ESRCH'});
  assert.equal(s.state.cleanupWarning,null);
});
test('cleanup uncertainty is a redacted warning, never a false FAIL or unhandled rejection', {skip:process.platform!=='win32'}, async () => {
  const r=await probe({transport:'stdio',command:process.execPath,args:[fixture,'ok']},{secrets:['hidden-cleanup-token'],runCommand:async()=>({code:1,text:'denied hidden-cleanup-token'})});
  assert.equal(r.failure,null);assert.equal(r.status,'WARNING');
  const warning=r.findings.find(f=>f.id==='CLEANUP_INCOMPLETE');assert.equal(warning.category,'connection');
  assert.match(warning.message,/denied/);assert.ok(!JSON.stringify(r).includes('hidden-cleanup-token'));
});
test('denied helper plus denied taskkill reports uncertainty; it cannot promise unknown descendants gone', {skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(root,'denied-tree-'));const path=join(dir,'pids');let pids;
  try{
    const report=await probe({transport:'stdio',command:process.execPath,args:[fixture,'tree',path]},{runCommand:async()=>({code:1,text:'helper and taskkill unavailable'})});
    pids=JSON.parse(await readFile(path,'utf8'));assert.equal(report.failure,null);assert.equal(report.status,'WARNING');
    assert.ok(report.findings.some(f=>f.id==='CLEANUP_INCOMPLETE'));assert.throws(()=>process.kill(pids.root,0),{code:'ESRCH'});
    // The test owns this PID from its fixture receipt and cleans it up; production cannot discover it in this denial case.
    assert.doesNotThrow(()=>process.kill(pids.descendant,0));
  }finally{
    if(!pids){try{pids=JSON.parse(await readFile(path,'utf8'));}catch{}}
    if(pids){try{process.kill(pids.descendant,'SIGKILL');}catch{}const end=Date.now()+2000;while(Date.now()<end){try{process.kill(pids.descendant,0);await new Promise(resolve=>setTimeout(resolve,10));}catch{break;}}assert.throws(()=>process.kill(pids.descendant,0),{code:'ESRCH'});}
    await rm(dir,{recursive:true,force:true});
  }
});
