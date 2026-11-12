import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { makeServer } from './common.js';

export async function runHttpFixture(mode) {
  const valid = mode === 'auth' || mode === 'sse';
  const transport = valid ? new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: mode !== 'sse' }) : null;
  const mcp = valid ? makeServer() : null;
  if (mcp) await mcp.connect(transport);
  const server = http.createServer(async (req, res) => {
    if (mode === 'auth' && req.headers.authorization !== `Bearer ${process.env.FIXTURE_TOKEN}`) {
      const status = process.env.FIXTURE_AUTH_STATUS === '403' ? 403 : 401;
      res.writeHead(status, { 'www-authenticate': 'Bearer' }).end();
    } else if (mode === 'hang') {
      // Intentionally leave the connection unanswered.
    } else if (mode === '500') {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(`fixture error: ${process.env.FIXTURE_SECRET ?? ''}`);
    } else if (mode === 'bad-json' || mode === 'wrong-content-type') {
      res.writeHead(200, { 'content-type': mode === 'bad-json' ? 'application/json' : 'text/html' }).end(mode === 'bad-json' ? 'not json' : '<html>not JSON-RPC</html>');
    } else if (req.url !== '/mcp') {
      res.writeHead(404).end();
    } else {
      try { await transport.handleRequest(req, res); }
      catch { if (!res.headersSent) res.writeHead(500); res.end(); }
    }
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`LISTENING ${server.address().port}\n`));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (mcp) await mcp.close();
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.stdin.resume();
  process.stdin.on('end', stop);
  process.on('SIGTERM', stop);
}
