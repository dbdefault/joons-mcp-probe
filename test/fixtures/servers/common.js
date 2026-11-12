import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Lets the integration suite verify that probe has reaped every stdio fixture.
if (process.env.FIXTURE_PID_FILE) writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));

export const tool = (name, description = `Description for ${name}`) => ({ name, description, inputSchema: { type: 'object', properties: {} } });
export const validTools = [tool('alpha'), tool('beta')];

export function makeServer() {
  const server = new Server({ name: 'fixture-server', version: '1.0.0' }, {
    capabilities: { tools: {} }, instructions: 'Fixture instructions.'
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: validTools }));
  return server;
}

export async function stdioServer() {
  const server = makeServer();
  await server.connect(new StdioServerTransport());
  const stop = async () => { await server.close(); process.exit(0); };
  process.stdin.on('end', stop);
  process.on('SIGTERM', stop);
}

export function rawServer(mode) {
  if (mode === 'early-exit') { process.stderr.write('fixture exited early\n', () => process.exit(3)); return; }
  if (mode === 'garbage') process.stdout.write('this is not JSON\n');
  if (mode === 'spawns-child') {
    if (!process.argv[2]) throw new Error('A PID file path is required');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    child.unref();
    writeFileSync(process.argv[2], String(child.pid));
  }
  const lines = createInterface({ input: process.stdin });
  lines.on('close', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  lines.on('line', line => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    const { id, method, params } = request;
    if (mode === 'garbage') return;
    if (mode === 'tool-call-tripwire' && !['initialize', 'notifications/initialized', 'tools/list', 'ping'].includes(method)) {
      if (!process.argv[2]) throw new Error('A tripwire file path is required');
      appendFileSync(process.argv[2], `${method}\n`);
    }
    if (id === undefined) return;
    const respond = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    if (method === 'initialize') {
      if (mode === 'handshake-fail') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'fixture handshake failed' } }) + '\n');
        return;
      }
      const answer = () => respond({ protocolVersion: mode === 'bad-protocol' ? '1999-01-01' : (params?.protocolVersion ?? '2025-11-25'), capabilities: { tools: {} }, serverInfo: { name: 'fixture-server', version: '1.0.0' }, instructions: 'Fixture instructions.' });
      if (mode === 'slow') setTimeout(answer, Number(process.argv[2] ?? process.env.FIXTURE_DELAY_MS ?? 5000));
      else answer();
    } else if (method === 'tools/list') {
      let tools = validTools;
      let nextCursor;
      if (mode === 'dup-tools') tools = [tool('duplicate'), tool('duplicate')];
      if (mode === 'bad-schema') tools = [{ ...tool('wrong_type'), inputSchema: { type: 'string' } }, { ...tool('invalid_properties'), inputSchema: { type: 'object', properties: 5 } }];
      if (mode === 'empty-tools') tools = [];
      if (mode === 'no-description') { const { description, ...rest } = tool('undescribed'); tools = [rest]; }
      if (mode === 'echo-secret') tools = [tool('secret', process.env.FIXTURE_SECRET ?? '')];
      if (mode === 'paginated') {
        const cursor = params?.cursor;
        const loop = process.argv[2] === 'loop' || process.env.FIXTURE_LOOP === '1';
        const page = cursor === 'page-2' ? 2 : cursor === 'page-3' ? 3 : 1;
        tools = [tool(`page_${page}`)];
        nextCursor = loop ? 'page-2' : page < 3 ? `page-${page + 1}` : undefined;
      }
      respond({ tools, ...(nextCursor && { nextCursor }) });
    } else if (method === 'ping') respond({});
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }) + '\n');
  });
}
