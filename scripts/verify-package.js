import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function npmCli() {
  const bin = dirname(process.execPath);
  const candidates = [process.env.npm_execpath, join(bin,'node_modules/npm/bin/npm-cli.js'), resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js'), resolve(bin,'../share/nodejs/npm/bin/npm-cli.js')];
  try { candidates.push(createRequire(import.meta.url).resolve('npm/bin/npm-cli.js')); } catch { }
  const found = candidates.find(path => path && /npm-cli\.js$/.test(path) && existsSync(path));
  if (!found) throw new Error('Installed npm CLI not found; package verification requires npm but never installs it');
  return found;
}
function run(file,args,cwd=root) {
  return new Promise((resolveRun,reject)=>{
    const child=spawn(file,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,npm_config_update_notifier:'false'}});
    let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Package verification command timed out'));},30000);
    child.stdout.on('data',b=>{out=(out+b).slice(-1000000);});child.stderr.on('data',b=>{err=(err+b).slice(-4000);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);code===0?resolveRun(out):reject(new Error(`Package command failed (${code}): ${err}`));});
  });
}
export async function verifyPackage() {
  const work=await mkdtemp(join(root,'.pack-check-'));
  try {
    const config=join(work,'user.npmrc'),globalConfig=join(work,'global.npmrc');await writeFile(config,'','utf8');await writeFile(globalConfig,'','utf8');
    const packed=JSON.parse(await run(process.execPath,[npmCli(),'pack','--json','--ignore-scripts','--offline','--cache',join(work,'cache'),'--userconfig',config,'--globalconfig',globalConfig,'--pack-destination',work]));
    const names=new Set(packed[0].files.map(file=>file.path));
    for(const required of ['docs/API.md','docs/ARCHITECTURE.md','examples/stdio-server.js','examples/github-actions.yml','src/index.js','src/checks-worker.js','scripts/process-tree.ps1','CONTRIBUTING.md','SECURITY.md','README.md','README.ko.md','LICENSE']) {
      if(!names.has(required))throw new Error(`Missing package entry: ${required}`);
    }
    const extracted=join(work,'unpacked');await mkdir(extracted);
    await run('tar',['-xf',join(work,packed[0].filename),'-C',extracted]);
    const packageRoot=join(extracted,'package');
    for(const file of ['README.md','README.ko.md']) {
      const content=await readFile(join(packageRoot,file),'utf8');
      for(const link of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target=link[1].split('#')[0];
        if(!target||/^[a-z]+:/i.test(target))continue;
        if(!existsSync(resolve(packageRoot,target)))throw new Error(`Broken packaged README link: ${target}`);
      }
    }
    const api=await import(pathToFileURL(join(packageRoot,'src/index.js')).href);
    const report=await api.probe({transport:'stdio',command:process.execPath,args:[join(packageRoot,'examples/stdio-server.js')]});
    if(report.status!=='PASS')throw new Error(`Packed example did not pass: ${report.failure?.kind??report.status}`);
    const version=(await run(process.execPath,[join(packageRoot,'bin/joons-mcp-probe.js'),'--version'])).trim();
    if(version!==api.VERSION)throw new Error('Packed CLI version does not match library');
    return {entries:names.size,exampleStatus:report.status,version};
  } finally { await rm(work,{recursive:true,force:true}); }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyPackage())); } catch(error) {console.error(error.message);process.exitCode=1;}
}
