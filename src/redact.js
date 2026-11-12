import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { boundData, boundReport, putData } from './bounded.js';

function credentialRules(secrets = []) {
  const seeds = new Set();
  const add = s => { if (typeof s === 'string' && s.length) seeds.add(s); };
  for (const supplied of secrets) {
    if (typeof supplied !== 'string' || !supplied.length) continue;
    add(supplied);
    try { add(decodeURIComponent(supplied)); } catch { }
    const bearer = /^Bearer\s+(.+)$/i.exec(supplied);
    if (bearer) add(bearer[1]);
    const basic = /^Basic\s+([A-Za-z0-9+/_=-]+)$/i.exec(supplied);
    if (basic) {
      const decoded = Buffer.from(basic[1], 'base64url').toString('utf8'); add(decoded);
      const colon = decoded.indexOf(':'); if (colon >= 0) add(decoded.slice(colon + 1));
    }
  }
  const patterns = new Set();
  for (const secret of seeds) for (const form of [secret, `Bearer ${secret}`, `user:${secret}`]) {
    patterns.add(form);
    try {
      const encoded = encodeURIComponent(form);
      patterns.add(encoded); patterns.add(encoded.replace(/%[A-F0-9]{2}/g, p => p.toLowerCase())); patterns.add(encoded.replace(/%20/g, '+'));
    } catch { /* Still mask literal and UTF-8 forms for unpaired surrogates. */ }
    const data = Buffer.from(form, 'utf8');
    patterns.add(data.toString('base64')); patterns.add(data.toString('base64').replace(/=+$/, '')); patterns.add(data.toString('base64url'));
  }
  return Array.from(patterns).sort((a, b) => b.length - a.length);
}
export function secretVariants(secrets = []) {
  return credentialRules(secrets);
}
export function createRedactor(secrets = []) {
  const patterns = credentialRules(secrets);
  // One pass prevents replacement markers being remasked by another supplied secret.
  const expression = patterns.length ? new RegExp(patterns.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu') : null;
  const mask = s => expression ? s.replace(expression, '***') : s;
  const visit = (value, onCollision) => boundData(value, { mapString: mask, mapKey: mask, onCollision });
  const redactReport = report => {
    let dropped = 0;
    const collision = () => { dropped++; };
    const result = sanitizeReport(boundReport(report), value => visit(value, collision), mask, collision);
    if (dropped) {
      result.findings ??= [];
      const existing = result.findings.find(f => f.id === 'REDACTED_KEYS_MERGED');
      if (!existing) result.findings.push({ id:'REDACTED_KEYS_MERGED', severity:'info', category:'security', message:mask(`Dropped ${dropped} colliding redacted object entries; first values retained.`) });
    }
    return result;
  };
  return { redact: value => visit(value), redactReport, contains: s => expression ? (expression.lastIndex = 0, expression.test(s)) : false, patterns };
}
export function redact(value, secrets = []) {
  const redactor = createRedactor(secrets);
  return isReport(value) ? redactor.redactReport(value) : redactor.redact(value);
}

function isReport(value) {
  return value && typeof value === 'object' && (value.schemaVersion === 1 || (Array.isArray(value.findings) && value.target && ['PASS', 'WARNING', 'FAIL'].includes(value.status)));
}

// The trust boundary is a schema path, never a key-name replacement or whole-JSON pass.
const rootControls = new Set(['schemaVersion', 'tool', 'status', 'timings', 'startedAt', 'finishedAt']);
const findingControls = new Set(['id', 'severity', 'category']);
const failureControls = new Set(['kind', 'step', 'exitCode']);
function sanitizeReport(report, freeText, mask, onCollision) {
  const fields = (value, known, controls = new Set(), overrides = {}) => {
    if (value == null) return value;
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const mappedKey = known.has(key) ? key : mask(key);
      if (Object.hasOwn(out, mappedKey)) { onCollision(); continue; }
      putData(out, mappedKey, controls.has(key) ? v : Object.hasOwn(overrides, key) ? overrides[key](v) : freeText(v));
    }
    return out;
  };
  const names = list => new Set(list.split(' '));
  const out = {};
  for (const [key, value] of Object.entries(report)) {
    if (rootControls.has(key)) { putData(out, key, value); continue; }
    let result;
    if (key === 'target') result = fields(value, names('transport command args url'), names('transport'));
    if (key === 'server') {
      const protectedKeys = new Set(['instructionsPresent']);
      if (SUPPORTED_PROTOCOL_VERSIONS.includes(value?.protocolVersion)) protectedKeys.add('protocolVersion');
      result = fields(value, names('name version protocolVersion capabilities instructionsPresent instructions instructionsText'), protectedKeys);
    }
    if (key === 'tools') result = fields(value, names('count pages items'), names('count pages'), { items: items => items.map(item => fields(item, names('name description hasDescription schemaValid'), names('hasDescription schemaValid'))) });
    if (key === 'findings') result = value.map(f => fields(f, names('id severity category message tool'), findingControls));
    if (key === 'failure') result = fields(value, names('kind step message exitCode stderrTail'), failureControls);
    const known = names('target server tools findings failure').has(key);
    putData(out, known ? key : mask(key), known ? result : freeText(value), onCollision);
  }
  return out;
}
export function redactReport(report, secrets = []) {
  return createRedactor(secrets).redactReport(report);
}

export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    if (parsed.search) {
      const keys = [...parsed.searchParams.keys()];
      parsed.search = '';
      for (const key of keys) parsed.searchParams.append(key, '***');
    }
    return parsed.toString();
  } catch {
    return '[invalid URL]';
  }
}

export function maskHeaders(headers) {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key, /authorization|cookie|token|secret|key|auth/i.test(key) ? '***' : value]));
}
