import { redactUrl } from '../redact.js';
import { terminalText } from '../text.js';
import { boundReport, putData } from '../bounded.js';

const orders = {
  root: ['schemaVersion', 'tool', 'startedAt', 'finishedAt', 'target', 'status', 'server', 'timings', 'tools', 'findings', 'failure'],
  tool: ['name', 'version'], target: ['transport', 'command', 'args', 'url'],
  server: ['name', 'version', 'protocolVersion', 'capabilities', 'instructionsPresent'],
  timings: ['connectMs', 'initializeMs', 'toolsListMs', 'totalMs'],
  tools: ['count', 'pages', 'items'], item: ['name', 'hasDescription', 'schemaValid'],
  finding: ['id', 'severity', 'category', 'message', 'tool'],
  failure: ['kind', 'step', 'message', 'exitCode', 'stderrTail'],
};
function ordered(value, kind) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => ordered(v, kind));
  const keys = orders[kind] ?? Object.keys(value).sort();
  const out = {};
  for (const key of keys) if (Object.hasOwn(value, key)) {
    const child = kind === 'root' ? key : kind === 'tools' && key === 'items' ? 'item' : kind === 'root' && key === 'findings' ? 'finding' : null;
    putData(out, key, ordered(value[key], key === 'findings' && kind === 'root' ? 'finding' : child));
  }
  return out;
}
export function renderJson(report) {
  const copy = ordered(boundReport(report), 'root');
  if (copy.target?.transport === 'http' && copy.target.url) copy.target.url = redactUrl(copy.target.url);
  return terminalText(JSON.stringify(copy, null, 2));
}
