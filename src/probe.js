import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { StringDecoder } from 'node:string_decoder';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { createTransport } from './transports.js';
import { diagnose } from './diagnose.js';
import { createRedactor, redactUrl } from './redact.js';
import { resolveStdioCommand } from './commands.js';
import { VERSION } from './version.js';
import { boundData, addDepthFinding } from './bounded.js';

function validate(target, options) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const strings = v => object(v) && Object.values(v).every(x => typeof x === 'string');
  if (!object(target) || !['stdio', 'http'].includes(target.transport)) throw new TypeError('Invalid target transport');
  if (target.transport === 'stdio') {
    if (typeof target.command !== 'string' || !target.command.trim() || (target.args !== undefined && (!Array.isArray(target.args) || target.args.some(a => typeof a !== 'string'))) || (target.cwd !== undefined && typeof target.cwd !== 'string') || (target.env !== undefined && !strings(target.env))) throw new TypeError('Invalid stdio target');
  } else {
    try { const u = new URL(target.url); if (!['http:', 'https:'].includes(u.protocol)) throw 0; } catch { throw new TypeError('Invalid HTTP URL'); }
    if (target.headers !== undefined && !strings(target.headers)) throw new TypeError('Invalid headers');
  }
  if (!object(options)) throw new TypeError('Invalid options');
  for (const key of ['stepTimeoutMs', 'totalTimeoutMs', 'slowThresholdMs', 'maxStderrBytes', 'closeTimeoutMs', 'maxTools', 'maxResponseBytes', 'maxTotalResponseBytes']) {
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] < (key === 'maxStderrBytes' || key === 'slowThresholdMs' ? 0 : 1))) throw new TypeError(`Invalid ${key}`);
  }
  if (options.secrets !== undefined && (!Array.isArray(options.secrets) || options.secrets.some(s => typeof s !== 'string'))) throw new TypeError('Invalid secrets');
  if (target.transport === 'stdio') resolveStdioCommand(target);
}

export async function probe(target, options = {}) {
  validate(target, options);
  const { stepTimeoutMs = 10000, totalTimeoutMs = 30000, maxStderrBytes = 65536, slowThresholdMs = 2000, closeTimeoutMs = 3000, maxTools = 10000 } = options;
  const secrets = [...(options.secrets ?? []), ...Object.values(target.env ?? {}), ...Object.values(target.headers ?? {})];
  if (target.transport === 'http') {
    const u = new URL(target.url);
    secrets.push(u.username, u.password);
    for (const value of u.searchParams.values()) secrets.push(value);
    if (u.password) { try { secrets.push(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`); } catch { } }
    for (const v of [u.username, u.password]) { try { secrets.push(decodeURIComponent(v)); } catch { /* malformed percent escape */ } }
  }
  const started = performance.now();
  const report = { schemaVersion: 1, tool: { name: 'joons-mcp-probe', version: VERSION }, startedAt: new Date().toISOString(), finishedAt: null,
    target: target.transport === 'stdio' ? { transport: 'stdio', command: target.command, args: target.args ?? [] } : { transport: 'http', url: redactUrl(target.url) },
    status: 'PASS', server: null, timings: { connectMs: null, initializeMs: null, toolsListMs: null, totalMs: 0 }, tools: null, findings: [], failure: null };
  const finding = (id, severity, category, message) => report.findings.push({ id, severity, category, message });
  const client = new Client({ name: 'joons-mcp-probe', version: VERSION }, { capabilities: {} });
  let step = 'connect', rawInitialize, rawTools = [], secretSeen = false, stderrScanTail = '', fatalReject, checksWorker, stepDeadline, responseTooDeep = false;
  const fatal = new Promise((_, reject) => { fatalReject = reject; });
  fatal.catch(() => {});
  const redactor = createRedactor(secrets);
  const scan = value => { if (!secretSeen && redactor.contains(value)) secretSeen = true; };
  let longestSecret = 0;
  for (const value of redactor.patterns) longestSecret = Math.max(longestSecret, value.length);
  const stderrDecoder = new StringDecoder('utf8');
  const session = createTransport(target, maxStderrBytes, { ...options,
    onMessage(message) {
      // Arbitrary remote dictionary keys are untrusted too (A3).
      const pending = [message.result, message.params, message.error?.message];
      while (pending.length && !secretSeen && redactor.patterns.length) {
        const value = pending.pop();
        if (typeof value === 'string') scan(value);
        else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
          if (value === message.result && key === 'protocolVersion' && SUPPORTED_PROTOCOL_VERSIONS.includes(item)) continue;
          if (value !== message.result && value !== message.result?.serverInfo) scan(key);
          pending.push(item);
        }
      }
      message = boundData(message, { onLimit: () => { responseTooDeep = true; } });
      if (step === 'initialize' && message.result?.protocolVersion) {
        rawInitialize = message.result;
        const info = message.result.serverInfo;
        if (info === undefined || (info && typeof info === 'object' && !Array.isArray(info))) return { ...message, result: { ...message.result, serverInfo: { ...info, name: info?.name ?? '', version: info?.version ?? '' } } };
      }
      return message;
    },
    onStderr(chunk) { const text = stderrScanTail + stderrDecoder.write(chunk); scan(text); stderrScanTail = longestSecret > 1 ? text.slice(-(longestSecret - 1)) : ''; }
  });
  // A transport error must wake the current step even if the SDK only calls onerror.
  client.onerror = error => fatalReject(error);
  session.transport.onerror = error => fatalReject(error);
  const interrupted = () => fatalReject(Object.assign(new Error('Inspection interrupted'), { kind: 'unknown' }));
  process.on('SIGINT', interrupted);
  const timed = async (name, key, operation) => {
    step = name; const begin = performance.now(); let timer;
    const remaining = totalTimeoutMs - (begin - started);
    try {
      if (remaining <= 0) throw Object.assign(new Error('Total timeout exceeded'), { kind: 'timeout' });
      const budget = Math.min(stepTimeoutMs, remaining);
      stepDeadline = Date.now() + budget;
      return await Promise.race([Promise.resolve().then(operation), fatal, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(remaining <= stepTimeoutMs ? 'Total timeout exceeded' : `Step ${name} timed out`), { kind: 'timeout' })), budget);
      })]);
    } finally {
      clearTimeout(timer); report.timings[key] = Math.round(performance.now() - begin);
      if (report.timings[key] > slowThresholdMs) finding('SLOW_STEP', 'warning', 'performance', `${name} exceeded slow threshold`);
    }
  };
  try {
    await timed('connect', 'connectMs', () => session.transport.start());
    await timed('initialize', 'initializeMs', () => client.connect(session.transport, { timeout: 2147483647 }));
    const info = client.getServerVersion();
    const capabilities = client.getServerCapabilities() ?? {};
    const version = rawInitialize?.protocolVersion;
    report.server = { name: info?.name ?? '', version: info?.version ?? '', protocolVersion: version, capabilities, instructionsPresent: typeof rawInitialize?.instructions === 'string' };
    if (!info?.name || !info?.version) finding('SERVER_INFO_INCOMPLETE', 'warning', 'protocol', 'Server information is incomplete');
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) finding('PROTOCOL_VERSION_UNSUPPORTED', 'fail', 'protocol', 'Server protocol version is unsupported');
    else if (version !== LATEST_PROTOCOL_VERSION) finding('PROTOCOL_VERSION_OLD', 'info', 'protocol', 'Server uses an older supported protocol version');
    if (!capabilities.tools) finding('CAPABILITY_TOOLS_MISSING', 'warning', 'protocol', 'Server does not advertise tools');
    else await timed('tools_list', 'toolsListMs', async () => {
      let cursor; const seen = new Set(); let pages = 0;
      do {
        const result = await client.request({ method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) }, z.looseObject({}), { timeout: 2147483647 });
        if (!Array.isArray(result.tools) || (result.nextCursor !== undefined && typeof result.nextCursor !== 'string')) throw Object.assign(new Error('Invalid tools/list response envelope'), { kind: 'invalid_response' });
        pages++;
        if (result.tools.length > maxTools - rawTools.length) {
          finding('TOOLS_LIMIT_EXCEEDED', 'fail', 'tools', 'Collected tool count exceeds maxTools');
          for (const tool of result.tools.slice(0, maxTools - rawTools.length)) rawTools.push(tool);
          break;
        }
        for (const tool of result.tools) rawTools.push(tool);
        cursor = result.nextCursor;
        if (cursor !== undefined && (seen.has(cursor) || pages >= 50)) { finding('TOOLS_PAGINATION_LOOP', 'fail', 'tools', 'Repeated cursor or pagination limit exceeded'); break; }
        seen.add(cursor);
      } while (cursor !== undefined);
      const checked = await new Promise((resolve, reject) => {
        checksWorker = new Worker(new URL('./checks-worker.js', import.meta.url), { workerData: { rawTools, deadline: stepDeadline - 25 } });
        checksWorker.once('message', resolve); checksWorker.once('error', reject);
        checksWorker.once('exit', code => { if (code !== 0) reject(new Error('Tool checker stopped')); });
      });
      report.tools = { count: rawTools.length, pages, items: checked.items };
      for (const value of checked.findings) report.findings.push(value);
      if (checked.budgetExceeded) throw Object.assign(new Error('Tool checks exhausted the inspection budget'), { kind: 'timeout' });
    });
  } catch (error) {
    scan(error.message ?? '');
    if (error.findingId === 'RESPONSE_TOO_LARGE') finding('RESPONSE_TOO_LARGE', 'fail', 'connection', 'Server response exceeds the configured byte limit');
    if (error.kind === 'timeout' && checksWorker) {
      if (!report.findings.some(f => f.id === 'CHECKS_BUDGET_EXCEEDED')) finding('CHECKS_BUDGET_EXCEEDED', 'warning', 'performance', 'Tool checks stopped at the inspection budget');
      finding('SLOW_STEP', 'warning', 'performance', 'Tool checks exceeded the inspection budget');
    }
    report.failure = diagnose(error, step, session.state);
  } finally {
    const workerStopped = checksWorker?.terminate();
    workerStopped?.catch(() => {});
    let timer;
    await Promise.race([session.close(), new Promise(resolve => { timer = setTimeout(() => { session.state.cleanupWarning ??= 'Cleanup deadline exceeded'; resolve(); }, closeTimeoutMs); })]);
    clearTimeout(timer);
    if (session.state.cleanupWarning) finding('CLEANUP_INCOMPLETE', 'warning', 'connection', session.state.cleanupWarning);
    process.removeListener('SIGINT', interrupted);
    if (session.state.truncated) finding('STDERR_TRUNCATED', 'info', 'connection', 'Server stderr exceeded capture limit');
    if (report.failure) report.failure.stderrTail = session.state.stderrTail;
    if (secretSeen) finding('SECRET_IN_RESPONSE', 'warning', 'security', 'A supplied secret appeared in server output');
    report.timings.totalMs = Math.round(performance.now() - started); report.finishedAt = new Date().toISOString();
  }
  if (responseTooDeep) addDepthFinding(report);
  report.status = report.failure || report.findings.some(f => f.severity === 'fail') ? 'FAIL' : report.findings.some(f => f.severity === 'warning') ? 'WARNING' : 'PASS';
  try {
    const sanitized = redactor.redactReport(report);
    if (sanitized.failure?.stderrTail) sanitized.failure.stderrTail = sanitized.failure.stderrTail.slice(-2000);
    return sanitized;
  } catch {
    // Defensive last boundary: never expose a raw graph, secret-bearing error or runtime stack.
    return { schemaVersion: 1, tool: { name: 'joons-mcp-probe', version: VERSION }, startedAt: report.startedAt, finishedAt: report.finishedAt,
      target: target.transport === 'stdio' ? { transport:'stdio', command:redactor.redact('[unavailable]'), args:[] } : { transport:'http', url:redactor.redact('[unavailable]') },
      status:'FAIL',server:null,timings:report.timings,tools:null,findings:[],failure:{kind:'invalid_response',step,message:redactor.redact('Report sanitization failed'),exitCode:session.state.exitCode??null,stderrTail:''} };
  }
}
