import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';

export async function getFreeClosedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function startHttpFixture(scriptPath, env = {}) {
  const child = spawn(process.execPath, [scriptPath], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  const exited = new Promise(resolve => child.once('close', resolve));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP fixture startup timed out')), 10000);
      const done = (fn, value) => { clearTimeout(timer); fn(value); };
      lines.on('line', line => { const match = /^LISTENING (\d+)$/.exec(line); if (match) done(resolve, Number(match[1])); });
      child.once('error', err => done(reject, err));
      child.once('close', code => done(reject, new Error(`HTTP fixture exited (${code}): ${stderr}`)));
    });
    let closed = false;
    return { url: `http://127.0.0.1:${port}/mcp`, close: async () => {
      if (closed) return;
      closed = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2000);
      try { await exited; } finally { clearTimeout(timer); lines.close(); }
    } };
  } catch (error) {
    child.kill();
    await exited;
    lines.close();
    throw error;
  }
}
