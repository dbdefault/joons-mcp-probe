import { createInterface } from 'node:readline';
const mode = process.argv[2];
const secret = process.env.FIXTURE_SECRET ?? 'test-secret-value';
const payload = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url'),
  Buffer.from(`Bearer ${secret}`).toString('base64'), Buffer.from(`Bearer ${secret}`).toString('base64url'),
  Buffer.from(`user:${secret}`).toString('base64'), Buffer.from(`user:${secret}`).toString('base64url')].join(' | ');
const controls = '\x1b[31mred\x1b[0m\x1b]0;title\x07\x00\x01\t\r\n\x7f\x85\x9b31m' + '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f\u061c' + 'text';
const send = (id, result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(!['initialize','notifications/initialized','tools/list','ping'].includes(m.method))process.exit(90);
  if(m.method==='initialize') {
    if(mode==='encoded-error'||mode==='controls-error') {
      const text=mode==='encoded-error'?payload:controls;
      process.stderr.write(text);
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:text}})+'\n');return;
    }
    send(m.id,{protocolVersion:'2025-11-25',serverInfo:{name:mode==='encoded'?payload:mode==='controls'?controls:'fixture',version:'1'},capabilities:{tools:{},...(mode==='encoded'?{echo:payload}:{})}});
  }else if(m.method==='tools/list'){
    if(mode==='tools150k')return send(m.id,{tools:Array.from({length:150000},()=>({}))});
    if(mode==='slowcpu')return send(m.id,{tools:Array.from({length:20000},(_,i)=>({name:`tool${i}`,description:'d',inputSchema:{type:'object',properties:{[`prop${i}`]:{type:'string',maxLength:i+1}}}}))});
    const name=mode==='encoded'?payload:mode==='controls'?controls:'echo';
    send(m.id,{tools:[{name,description:name,inputSchema:{type:'object'}}]});
  }
});
