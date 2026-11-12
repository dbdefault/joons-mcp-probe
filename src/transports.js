import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveStdioCommand, stdioEnvironment } from './commands.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const allowed = new Set(['initialize', 'notifications/initialized', 'tools/list', 'ping']);
const tooLarge = () => Object.assign(new Error('Response byte limit exceeded'), { kind: 'invalid_response', findingId: 'RESPONSE_TOO_LARGE' });
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
// Non-rejecting from construction, including spawn errors and command timeouts.
function command(file, args, timeout) {
  return new Promise(resolve => {
    let child, text = '', finished = false;
    const done = result => { if (finished) return; finished = true; clearTimeout(timer); resolve({ ...result, text }); };
    const timer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch { } done({ code: null }); }, Math.max(1, timeout));
    try {
      child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { text = (text + b.toString()).slice(-16000); });
      child.once('error', e => done({ code: null, error: e.message }));
      child.once('close', code => done({ code }));
    } catch (e) { done({ code: null, error: e.message }); }
  });
}
export { command as runCleanupCommand };
export function createTransport(target, maxStderrBytes = 65536, options = {}) {
  const executable = target.transport === 'stdio' ? resolveStdioCommand(target) : null;
  const { closeTimeoutMs = 3000, maxResponseBytes = 4 * 1024 * 1024, maxTotalResponseBytes = 16 * 1024 * 1024, onMessage = () => {}, onStderr = () => {}, runCommand = command } = options;
  const state = { exited: false, exitCode: null, stderrTail: '', truncated: false, pid: null, descendants: [], cleanupWarning: null, collectedBytes: 0 };
  let child, startPromise, closing, stopped = false, tail = Buffer.alloc(0), stderrBytes = 0, pendingLine = 0, launchedAt, delegate;
  const safeRun = async (...args) => { try { return await runCommand(...args); } catch (e) { return { code: null, text: '', error: e.message }; } };
  const input = new ReadBuffer({ maxBufferSize: maxResponseBytes + 2 });
  let closedNotified = false;
  const notifyClose = () => { if (!closedNotified) { closedNotified = true; transport.onclose?.(); } };
  const fail = e => { if (!stopped) transport.onerror?.(e); };
  const account = n => { state.collectedBytes += n; if (state.collectedBytes > maxTotalResponseBytes) throw tooLarge(); };
  const deliver = message => { if (!stopped && message) { const normalized = onMessage(message); transport.onmessage?.(normalized ?? message); } };
  function stderr(chunk) {
    onStderr(chunk); stderrBytes += chunk.length; state.truncated = stderrBytes > maxStderrBytes;
    tail = maxStderrBytes ? Buffer.concat([tail, chunk.subarray(-maxStderrBytes)]).subarray(-maxStderrBytes) : Buffer.alloc(0);
    state.stderrTail = tail.toString('utf8').slice(-2000);
  }
  async function boundedFetch(url, init) {
    const response = await fetch(url, init);
    if (!response.body) return response;
    let messageBytes = 0, previousLF = false, cancelled = false;
    const sse = response.headers.get('content-type')?.startsWith('text/event-stream');
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) { controller.close(); return; }
          account(value.byteLength);
          for (const b of value) {
            if (++messageBytes > maxResponseBytes) throw tooLarge();
            if (sse && b === 10 && previousLF) messageBytes = 0;
            if (b !== 13) previousLF = b === 10;
          }
          controller.enqueue(value);
        } catch (e) { if (cancelled) return; fail(e); reader.cancel().catch(() => {}); controller.error(e); }
      }, cancel(reason) { cancelled = true; return reader.cancel(reason); }
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const transport = {
    start() {
      if (stopped) return Promise.reject(new Error('Transport already closed'));
      if (startPromise) return startPromise;
      if (target.transport === 'http') {
        delegate = new StreamableHTTPClientTransport(new URL(target.url), { fetch: boundedFetch, requestInit: { headers: target.headers }, reconnectionOptions: { maxRetries: 0 } });
        delegate.onmessage = deliver; delegate.onerror = fail; delegate.onclose = notifyClose;
        startPromise = delegate.start();
      } else startPromise = new Promise((resolve, reject) => {
        launchedAt = Date.now();
        child = spawn(executable, target.args ?? [], { cwd: target.cwd, env: stdioEnvironment(target), stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32' });
        state.pid = child.pid ?? null;
        child.once('error', e => { reject(e); fail(e); }); child.once('spawn', resolve);
        child.once('exit', code => { state.exited = true; state.exitCode = code; notifyClose(); });
        child.stdin.on('error', fail); child.stdout.on('error', fail); child.stderr.on('error', fail);
        child.stderr.on('data', stderr);
        child.stdout.on('data', chunk => {
          if (stopped) return;
          try {
            account(chunk.length);
            let offset = 0;
            while (offset < chunk.length) {
              const end = chunk.indexOf(10, offset), until = end === -1 ? chunk.length : end + 1;
              const slice = chunk.subarray(offset, until); pendingLine += slice.length;
              if (pendingLine > maxResponseBytes) throw tooLarge();
              input.append(slice);
              if (end !== -1) { pendingLine = 0; deliver(input.readMessage()); }
              offset = until;
            }
          } catch (e) { fail(e); }
        });
      });
      startPromise.catch(() => {});
      return startPromise;
    },
    setProtocolVersion(version) { delegate?.setProtocolVersion(version); },
    async send(message) {
      if (message.method && !allowed.has(message.method)) throw new Error('Outbound method is outside inspection allowlist');
      if (stopped) throw new Error('Transport closed');
      if (delegate) return delegate.send(message);
      return new Promise((resolve, reject) => child.stdin.write(serializeMessage(message), e => e ? reject(e) : resolve()));
    },
    close() {
      if (closing) return closing;
      stopped = true;
      let timer;
      const work = cleanup().catch(e => { state.cleanupWarning = `Cleanup could not be verified: ${e.message}`; });
      closing = Promise.race([work, new Promise(resolve => { timer = setTimeout(() => {
        state.cleanupWarning ??= 'Cleanup deadline exceeded';
        if (child && !state.exited) { try { child.kill('SIGKILL'); } catch { } }
        resolve();
      }, closeTimeoutMs); })]).finally(() => {
        clearTimeout(timer);
        input.clear(); child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy(); notifyClose();
      }).catch(e => { state.cleanupWarning ??= `Cleanup could not be verified: ${e.message}`; });
      return closing;
    }
  };
  async function cleanup() {
    const deadline = Date.now() + closeTimeoutMs, remaining = () => Math.max(1, deadline - Date.now());
    if (delegate) { await Promise.race([delegate.close(), new Promise(resolve => setTimeout(resolve, remaining()).unref())]); return; }
    if (!child?.pid) return;
    let diagnostics = '';
    if (process.platform === 'win32') {
      const snapshot = await safeRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../scripts/process-tree.ps1', import.meta.url)), String(child.pid), String(launchedAt)], Math.min(1500, remaining()));
      let snapshotOK = snapshot.code === 0;
      try { const records = JSON.parse(snapshot.text.trim() || '[]'); if (!Array.isArray(records) || records.some(p => !Number.isSafeInteger(p) || p <= 0)) snapshotOK = false; else state.descendants = records; } catch { snapshotOK = false; }
      if (!state.exited && pidAlive(child.pid)) {
        const killed = await safeRun('taskkill', ['/PID', String(child.pid), '/T', '/F'], Math.min(800, remaining()));
        if (killed.code !== 0) diagnostics = (killed.text || killed.error || `taskkill exit ${killed.code}`).slice(-2000);
      }
      if (!state.exited) { try { child.kill('SIGKILL'); } catch { /* verified below */ } }
      // The helper terminates descendants while retaining kernel handles; never kill a stale PID here.
      if (!snapshotOK) diagnostics += '\nDescendant snapshot unavailable';
    } else {
      // Once the original leader has exited, a live process with that PID is a new owner.
      if (state.exited && pidAlive(child.pid)) { state.cleanupWarning = 'Root PID was reused; group cleanup was not attempted'; return; }
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') diagnostics = e.message; }
    }
    const groupLive = () => { if (process.platform === 'win32') return false; try { process.kill(-child.pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
    const live = () => (!state.exited && pidAlive(child.pid)) || state.descendants.some(pidAlive) || groupLive();
    while (live() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    if (live()) state.cleanupWarning = `Process cleanup incomplete. ${diagnostics}`;
    else if (diagnostics.includes('Descendant snapshot unavailable')) state.cleanupWarning = `Process tree cleanup could not be verified. ${diagnostics}`;
  }
  return { transport, state, close: () => transport.close() };
}
