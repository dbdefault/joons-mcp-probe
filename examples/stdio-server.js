import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'example-server', version: '1.0.0' });
server.registerTool('hello', { description: 'Return a greeting.', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: 'Hello!' }] }));
await server.connect(new StdioServerTransport());
