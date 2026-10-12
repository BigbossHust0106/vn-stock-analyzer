import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { cleanup } from './database.mjs';

const steps = [
  ['Typecheck strict', 'typecheck'],
  ['ESLint (0 warning)', 'lint'],
  ['Prettier check', 'format:check'],
  ['Vitest + coverage >=80%', 'test'],
  ['Build web + worker', 'build'],
  ['Gitleaks', 'verify:secrets'],
  ['Migrations PostgreSQL', 'verify:migrations'],
  ['RLS 2 users', 'verify:rls'],
  ['VPS fixture parser', 'test:provider'],
];
mkdirSync('.cache', { recursive: true });
const log = createWriteStream('.cache/verify.log');
const summary = steps.map(([name]) => ({ name, status: 'NOT RUN' }));
const env = {
  ...process.env,
  VERIFY_RUN_ID: randomUUID(),
  NEXT_TELEMETRY_DISABLED: '1',
  WRANGLER_SEND_METRICS: 'false',
};
function print(text) {
  process.stdout.write(text);
  log.write(text);
}
let failed = false;
try {
  for (let i = 0; i < steps.length; i++) {
    const [name, command] = steps[i];
    print(`\n[${i + 1}/${steps.length}] ${name}\n`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', command], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (data) => print(data.toString()));
      child.stderr.on('data', (data) => print(data.toString()));
      child.once('error', reject);
      child.once('exit', (status) => resolve(status ?? 1));
    });
    summary[i].status = code === 0 ? 'PASS' : 'FAIL';
    if (code !== 0) {
      failed = true;
      break;
    }
  }
} catch (error) {
  const pending = summary.find((item) => item.status === 'NOT RUN');
  if (pending) pending.status = 'FAIL';
  print(`${error.message}\n`);
  failed = true;
} finally {
  try {
    cleanup(env.VERIFY_RUN_ID);
  } catch (error) {
    print(`Cleanup FAIL: ${error.message}\n`);
    failed = true;
  }
  print('\nBẢNG TỔNG KẾT VERIFY\n');
  print('| Bước | Kết quả |\n| --- | --- |\n');
  for (const { name, status } of summary) print(`| ${name} | ${status} |\n`);
  print(`\nVERIFY ${failed ? 'FAIL' : 'PASS'}\n`);
  writeFileSync(
    '.cache/verify-summary.json',
    JSON.stringify(
      { runId: env.VERIFY_RUN_ID, summary, passed: !failed },
      null,
      2,
    ),
  );
  log.end();
  if (failed) process.exitCode = 1;
}
