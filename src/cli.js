import { writeFile } from 'node:fs/promises';
import { parseArgs, UsageError } from './args.js';
import { probe as defaultProbe } from './index.js';
import { renderJson as defaultJson } from './report/json.js';
import { renderMarkdown as defaultMarkdown } from './report/markdown.js';
import { redactReport } from './redact.js';
import { VERSION } from './version.js';
import { terminalText } from './text.js';

const HELP = `Usage: joons-mcp-probe stdio [options] -- <command> [args...]
       joons-mcp-probe http <url> [options]
Options:
  --cwd DIR                 Child working directory
  --env NAME                Pass a named environment variable (repeatable)
  --header NAME=ENVVAR      Read a header from the environment (repeatable)
  --step-timeout MS         Step timeout
  --total-timeout MS        Total timeout
  --slow MS                 Slow step threshold
  --format json|markdown    Output format (default markdown)
  --json-out FILE           Write JSON report
  --md-out FILE             Write Markdown report
  --fail-on warning|fail    Failure threshold (default fail)
  --quiet                   Suppress standard output
  --help                    Show this help
  --version                 Show version
Exit codes: 0 success, 1 warning threshold, 2 failed probe, 3 usage error,
            4 output error (stdout or report file could not be written)
Windows .cmd/.bat files require explicit opt-in: stdio -- cmd.exe /d /s /c <file>
`;

export async function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = process, deps = {}) {
  const { probe = defaultProbe, renderJson = defaultJson, renderMarkdown = defaultMarkdown } = deps;
  let parsed;
  try { parsed = parseArgs(argv, env); }
  catch (error) { stderr.write(error instanceof UsageError ? `Error: ${error.message}\n` : 'Error: Invalid arguments.\n'); return 3; }
  if (parsed.command === 'help' || parsed.command === 'version') {
    try { await writeOutput(stdout, parsed.command === 'help' ? HELP : `${VERSION}\n`); return 0; }
    catch { return 4; }
  }
  const { target, options, output } = parsed;
  let report;
  try {
    report = await probe(target, options);
  } catch { stderr.write('Error: Unable to complete probe.\n'); return 3; }
  const exitCode = report.status === 'FAIL' ? 2 : report.status === 'WARNING' && output.failOn === 'warning' ? 1 : 0;
  try {
    const safeReport = redactReport(report, options.secrets);
    const json = () => terminalText(renderJson(safeReport));
    const markdown = () => terminalText(renderMarkdown(safeReport));
    if (output.jsonOut) await writeFile(output.jsonOut, json(), 'utf8');
    if (output.mdOut) await writeFile(output.mdOut, markdown(), 'utf8');
    if (!output.quiet) await writeOutput(stdout, output.format === 'json' ? json() : markdown());
    return exitCode;
  } catch { stderr.write('Error: Output error.\n'); return 4; }
}

function writeOutput(stream, text) {
  // Test adapters may have a synchronous write function; Node streams report errors asynchronously.
  if (typeof stream.once !== 'function') { stream.write(text); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const failed = error => { stream.off('error', failed); reject(error); };
    stream.once('error', failed);
    stream.write(text, error => { if (error) reject(error); else { stream.off('error', failed); resolve(); } });
  });
}
