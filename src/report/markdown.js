import { redactUrl } from '../redact.js';
import { humanText } from '../text.js';
import { boundReport } from '../bounded.js';

function safe(value) {
  const s = humanText(value ?? '—').slice(0, 300);
  return s.replace(/&/g, '&amp;').replace(/\\/g, '&#92;').replace(/\|/g, '&#124;').replace(/`/g, '&#96;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n|\r|\n/g, ' ');
}
export function renderMarkdown(report) {
  report = boundReport(report);
  const target = report.target ?? {};
  const targetText = target.transport === 'http' ? redactUrl(target.url) : [target.command, ...(target.args ?? [])].filter(x => x != null).join(' ');
  const out = [`# MCP Probe: ${safe(report.status)}`, '', `Target: ${safe(target.transport)} ${safe(targetText)}`, '', '## Server', '', '| Field | Value |', '| --- | --- |'];
  for (const [label, key] of [['Name','name'], ['Version','version'], ['Protocol version','protocolVersion'], ['Capabilities','capabilities'], ['Instructions present','instructionsPresent']]) {
    let value = report.server?.[key];
    if (value && typeof value === 'object') value = JSON.stringify(value);
    out.push(`| ${label} | ${safe(value)} |`);
  }
  out.push('', '## Timings', '', '| Step | Milliseconds |', '| --- | ---: |');
  for (const [label, key] of [['Connect','connectMs'], ['Initialize','initializeMs'], ['Tools list','toolsListMs'], ['Total','totalMs']]) out.push(`| ${label} | ${safe(report.timings?.[key])} |`);
  out.push('', '## Tools', '', '| Name | Description | Schema valid |', '| --- | --- | --- |');
  for (const tool of report.tools?.items ?? []) out.push(`| ${safe(tool.name)} | ${safe(tool.description ?? tool.hasDescription)} | ${safe(tool.schemaValid)} |`);
  if (!report.tools?.items?.length) out.push('| — | — | — |');
  out.push('', '## Findings');
  for (const severity of ['fail', 'warning', 'info']) {
    const findings = (report.findings ?? []).filter(f => f.severity === severity);
    if (!findings.length) continue;
    out.push('', `### ${severity}`);
    for (const f of findings) out.push(`- ${safe(f.id)}${f.tool ? ` (${safe(f.tool)})` : ''}: ${safe(f.message)}`);
  }
  if (report.failure) {
    const f = report.failure;
    out.push('', '## Failure', '', `- Kind: ${safe(f.kind)}`, `- Step: ${safe(f.step)}`, `- Message: ${safe(f.message)}`, `- Exit code: ${safe(f.exitCode)}`, '', 'Stderr tail:', '', '```text', safe(f.stderrTail), '```');
  }
  return out.join('\n') + '\n';
}
