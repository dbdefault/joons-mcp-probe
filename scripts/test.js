import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const filters = process.argv.slice(2);
try {
  const entries = await readdir(join(root, 'test'), { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.test.js') &&
    (filters.length === 0 || filters.some(filter => entry.name.includes(filter))))
    .map(entry => join(root, 'test', entry.name)).sort();
  if (files.length === 0) {
    console.error('No matching test files.');
    process.exitCode = 1;
  } else {
    const reporters = process.env.PROBE_TEST_REPORT ? ['--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter=junit',`--test-reporter-destination=${process.env.PROBE_TEST_REPORT}`] : [];
    const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...reporters, ...files], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', error => { console.error(`Could not start tests: ${error.message}`); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  console.error(`Could not collect tests: ${error.message}`);
  process.exitCode = 1;
}
