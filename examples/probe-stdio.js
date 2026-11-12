import { probe, renderMarkdown } from 'joons-mcp-probe';

const report = await probe({
  transport: 'stdio', command: process.execPath, args: ['examples/stdio-server.js'],
});
console.log(renderMarkdown(report));
