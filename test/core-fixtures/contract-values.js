import { createInterface } from 'node:readline';
const secret = process.env.S1X ?? 'placeholder';
const text = `before ${secret} after`;
const error = process.argv[2] === 'error';
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (!['initialize','notifications/initialized','tools/list','ping'].includes(m.method)) process.exit(90);
  const send = result => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
  if (m.method === 'initialize') {
    if (error) {
      process.stderr.write(text);
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:text}})+'\n');
    } else send({protocolVersion:'2025-11-25',serverInfo:{name:text,version:secret},capabilities:{tools:{},status:text,feature:true,numeric:1}});
  } else if (m.method === 'tools/list') {
    const tool={name:secret,description:text,inputSchema:{type:'object'}};
    send({tools:[tool,tool]});
  }
});
