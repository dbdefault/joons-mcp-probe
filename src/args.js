import { parseArgs as parseNodeArgs } from 'node:util';
import { resolveStdioCommand } from './commands.js';

export class UsageError extends Error {
  constructor(message) { super(message); this.name = 'UsageError'; }
}

const definitions = {
  cwd: { type: 'string' }, env: { type: 'string', multiple: true },
  header: { type: 'string', multiple: true }, 'step-timeout': { type: 'string' },
  'total-timeout': { type: 'string' }, slow: { type: 'string' },
  format: { type: 'string' }, 'json-out': { type: 'string' },
  'md-out': { type: 'string' }, 'fail-on': { type: 'string' },
  quiet: { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' },
};

export function parseArgs(argv, env = process.env) {
  const separator = argv.indexOf('--');
  const before = separator < 0 ? argv : argv.slice(0, separator);
  const after = separator < 0 ? [] : argv.slice(separator + 1);
  let parsed;
  try { parsed = parseNodeArgs({ args: before, options: definitions, allowPositionals: true, strict: true }); }
  catch { throw new UsageError('Invalid or unknown option; use --help for usage.'); }
  const v = parsed.values;
  if (v.help || v.version) return { command: v.help ? 'help' : 'version', target: null, options: {}, output: {} };
  const [command, ...pos] = parsed.positionals;
  if (!['stdio', 'http'].includes(command)) throw new UsageError('Expected stdio or http command.');
  if (command === 'stdio' && (separator < 0 || !after.length || pos.length)) throw new UsageError('stdio requires -- followed by an executable and optional arguments.');
  if (command === 'http' && (separator >= 0 || pos.length !== 1)) throw new UsageError('http requires one URL.');
  if (command === 'stdio' && v.header || command === 'http' && (v.cwd !== undefined || v.env)) throw new UsageError('Option is not valid for this transport.');
  const options = { secrets: [] };
  for (const [flag, key] of [['step-timeout', 'stepTimeoutMs'], ['total-timeout', 'totalTimeoutMs'], ['slow', 'slowThresholdMs']]) {
    if (v[flag] !== undefined) {
      if (!/^\d+$/.test(v[flag]) || !Number.isSafeInteger(Number(v[flag])) || Number(v[flag]) < 1) throw new UsageError(`--${flag} must be a positive integer.`);
      options[key] = Number(v[flag]);
    }
  }
  const output = { format: v.format ?? 'markdown', failOn: v['fail-on'] ?? 'fail', quiet: v.quiet ?? false, jsonOut: v['json-out'], mdOut: v['md-out'] };
  if (!['json', 'markdown'].includes(output.format)) throw new UsageError('--format must be json or markdown.');
  if (!['warning', 'fail'].includes(output.failOn)) throw new UsageError('--fail-on must be warning or fail.');
  const target = command === 'stdio' ? { transport: 'stdio', command: after[0], args: after.slice(1) } : { transport: 'http', url: pos[0] };
  if (command === 'stdio') {
    if (!after[0]) throw new UsageError('Executable must not be empty.');
    if (v.cwd !== undefined) target.cwd = v.cwd;
    if (v.env) {
      target.env = {};
      for (const name of v.env) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UsageError('Invalid environment variable name.');
        if (Object.hasOwn(env, name) && env[name] !== undefined) { Object.defineProperty(target.env, name, { value: env[name], enumerable: true, configurable: true, writable: true }); options.secrets.push(env[name]); }
      }
    }
  } else {
    try { const u = new URL(pos[0]); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); for (const s of [u.username, u.password, ...u.searchParams.values()]) if (s) { options.secrets.push(s); try { options.secrets.push(decodeURIComponent(s)); } catch {} } } catch { throw new UsageError('Invalid HTTP URL.'); }
    if (v.header) {
      target.headers = {};
      for (const entry of v.header) {
        const match = /^([^=]+)=([A-Za-z_][A-Za-z0-9_]*)$/.exec(entry);
        if (!match || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(match[1])) throw new UsageError('Header must be NAME=ENVVAR.');
        if (!Object.hasOwn(env, match[2]) || env[match[2]] === undefined) throw new UsageError('Header environment variable is missing.');
        Object.defineProperty(target.headers, match[1], { value: env[match[2]], enumerable: true, configurable: true, writable: true }); options.secrets.push(env[match[2]]);
      }
    }
  }
  if (target.transport === 'stdio') {
    try { resolveStdioCommand(target); } catch (e) { throw new UsageError(e.message); }
  }
  return { command, target, options, output };
}
