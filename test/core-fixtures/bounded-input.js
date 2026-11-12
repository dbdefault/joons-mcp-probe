import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
export function response(m, mode = 'deep', secret = 'ab') {
  if (m.method === 'initialize') {
    if (mode === 'deep') return '{"jsonrpc":"2.0","id":'+JSON.stringify(m.id)+',"result":{"protocolVersion":"2025-11-25","serverInfo":{"name":"deep","version":"1"},"capabilities":{"tools":{},"experimental":'+ '{"x":'.repeat(10000)+'0'+'}'.repeat(10000)+'}}}';
    return JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-11-25',serverInfo:{name:`prefix${secret}suffix`,version:'1'},capabilities:{tools:{},experimental:{[`key-${secret}-end`]:{value:`prefix${secret}suffix`}}}}});
  }
  if (m.method === 'tools/list') return JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:'Echo input',inputSchema:{type:'object'}}]}});
  return null;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line);
    if(!['initialize','notifications/initialized','tools/list','ping'].includes(m.method))process.exit(90);
    const body=response(m,process.argv[2],process.env.S1X);
    if(body)process.stdout.write(body+'\n');
  });
}
