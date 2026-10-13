// Minimal smoke test: both entry files parse, and running the CLI with no
// arguments prints usage and exits non-zero.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

function run(args, label) {
  const r = spawnSync(node, args, { cwd: root, encoding: 'utf8' });
  return { ...r, label };
}

const checks = [
  run(['--check', 'index.js'], 'index.js parses'),
  run(['--check', 'lib/direct.js'], 'lib/direct.js parses'),
];
for (const c of checks) {
  if (c.status !== 0) {
    console.error(`FAIL: ${c.label}\n${c.stderr}`);
    process.exit(1);
  }
  console.log(`ok - ${c.label}`);
}

const usage = run(['index.js'], 'usage');
if (usage.status === 0 || !/Usage: filet/.test(usage.stderr)) {
  console.error(`FAIL: expected usage message and non-zero exit\nstatus=${usage.status}\n${usage.stderr}`);
  process.exit(1);
}
console.log('ok - prints usage without arguments');
