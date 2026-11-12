import { probe, renderJson } from '../../src/index.js';
const report = await probe({transport:'stdio',command:process.execPath,args:[process.argv[2],process.argv[3]??'handshake']},{runCommand:async()=>{throw new Error('cleanup denied');}});
process.stdout.write(renderJson(report));
process.exitCode=report.status==='FAIL'?2:0;
