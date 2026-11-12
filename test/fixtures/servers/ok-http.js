import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { makeServer } from './common.js';

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
const mcp = makeServer();
await mcp.connect(transport);
const server = http.createServer(async (req, res) => {
  if (process.env.FIXTURE_TOKEN && req.headers.authorization !== `Bearer ${process.env.FIXTURE_TOKEN}`) {
    res.writeHead(401).end();
  } else if (req.url !== '/mcp') {
    res.writeHead(404).end();
  } else {
    try { await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  }
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`LISTENING ${server.address().port}\n`));
const stop = async () => { await mcp.close(); server.closeAllConnections(); server.close(() => process.exit(0)); };
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
