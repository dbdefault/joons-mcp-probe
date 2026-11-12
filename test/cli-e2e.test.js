import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'node:http';
const bin=fileURLToPath(new URL('../bin/joons-mcp-probe.js',import.meta.url));
const fixture=name=>fileURLToPath(new URL(`./fixtures/servers/${name}.js`,import.meta.url));
const testRoot=fileURLToPath(new URL('.',import.meta.url));
function cli(args,env={}) {
  return new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,[bin,...args],{env:{...process.env,...env},windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>{c.kill('SIGKILL');reject(new Error('CLI deadline'));},15000);
    c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.once('error',reject);
    c.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});
  });
}
test('real CLI exit code matrix 0/1/2/3 and output error 4',async()=>{
  for(const [name,flags,expected] of [['ok-stdio',[],0],['empty-tools',[],0],['empty-tools',['--fail-on','warning'],1],['dup-tools',[],2],['handshake-fail',[],2]]) {
    const r=await cli(['stdio','--format','json',...flags,'--',process.execPath,fixture(name)]);
    assert.equal(r.code,expected,r.err);assert.equal(r.err,'');assert.ok(JSON.parse(r.out).status);
  }
  assert.equal((await cli(['--unknown'])).code,3);
  const bad=await cli(['stdio','--json-out',join(testRoot,'does-not-exist','out.json'),'--',process.execPath,fixture('ok-stdio')]);
  assert.equal(bad.code,4);assert.match(bad.err,/Output error/);
});
test('real CLI masks short env values in JSON and Markdown',async()=>{
  const core=fileURLToPath(new URL('./core-fixtures/server.js',import.meta.url));
  for(const secret of ['§','§±','§±¶']) for(const format of ['json','markdown']) {
    const r=await cli(['stdio','--env','FIXTURE_SECRET','--format',format,'--',process.execPath,core,'secret'],{FIXTURE_SECRET:secret});
    assert.equal(r.code,0,r.err);assert.ok(!r.out.includes(secret));assert.equal(r.err,'');
  }
});
test('CLI SIGINT handler resolves only after the descendant is gone',async()=>{
  const dir=await mkdtemp(join(testRoot,'interrupt-'));
  const pidFile=join(dir,'pids');
  const runner=fileURLToPath(new URL('./core-fixtures/cli-interrupt.js',import.meta.url));
  const server=fileURLToPath(new URL('./core-fixtures/server.js',import.meta.url));
  const child=spawn(process.execPath,[runner,'stdio','--step-timeout','10000','--format','json','--',process.execPath,server,'tree-hang',pidFile],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe','ipc']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});ended.catch(()=>{});
  const timer=setTimeout(()=>child.kill('SIGKILL'),12000);
  try {
    let pids; const deadline=Date.now()+5000;
    while(!pids&&Date.now()<deadline){try{pids=JSON.parse(await readFile(pidFile,'utf8'));}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
    assert.ok(pids,'server must start before interrupt');
    if(process.platform==='win32') child.send('SIGINT');else child.kill('SIGINT');
    const code=await ended;assert.equal(code,2,err);assert.equal(err,'');assert.equal(JSON.parse(out).failure.message,'Inspection interrupted');
    for(const pid of Object.values(pids))assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  } finally {clearTimeout(timer);child.kill('SIGKILL');await ended;await rm(dir,{recursive:true,force:true});}
});
test('real CLI short HTTP header and URL query secrets in JSON and Markdown',async()=>{
  const server=createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk;
    if(!data){res.writeHead(405);res.end();return;}
    const m=JSON.parse(data);if(m.id===undefined){res.writeHead(202);res.end();return;}
    const secret=req.headers['x-secret']||new URL(req.url,'http://127.0.0.1').searchParams.get('key');
    const result=m.method==='initialize'?{protocolVersion:'2025-11-25',serverInfo:{name:secret,version:'1'},capabilities:{tools:{}}}:{tools:[{name:'echo',description:secret,inputSchema:{type:'object'}}]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const source of ['header','query'])for(const secret of ['§','§±','§±¶'])for(const format of ['json','markdown']){
      const url=`http://127.0.0.1:${server.address().port}/mcp${source==='query'?`?key=${encodeURIComponent(secret)}`:''}`;
      const r=await cli(['http',url,'--format',format,...(source==='header'?['--header','X-Secret=TOKEN']:[])],{TOKEN:secret});
      assert.equal(r.code,0,r.err);assert.ok(!r.out.includes(secret));assert.equal(r.err,'');
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
