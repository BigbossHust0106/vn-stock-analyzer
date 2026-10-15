import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';

const image =
  'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const stateFile = process.env.VERIFY_RUN_ID
  ? `.cache/verify-db-${process.env.VERIFY_RUN_ID}.json`
  : '.cache/verify-db.json';
const label = 'vn-stock-analyzer.verify';
function docker(args, input) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`docker ${args[0]} thất bại: ${result.stderr}`);
  return result.stdout.trim();
}
function state() {
  if (!existsSync(stateFile))
    throw new Error('Chạy npm run verify:migrations trước');
  const value = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (
    typeof value.name !== 'string' ||
    !/^vn-stock-verify-[a-f0-9-]+$/.test(value.name)
  )
    throw new Error('DB state không hợp lệ');
  if (process.env.VERIFY_RUN_ID && value.runId !== process.env.VERIFY_RUN_ID)
    throw new Error('DB không thuộc lần verify hiện tại');
  return value;
}
export function cleanup(runId) {
  const file = runId ? `.cache/verify-db-${runId}.json` : stateFile;
  if (!existsSync(file)) return;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (
    typeof value.name !== 'string' ||
    !/^vn-stock-verify-[a-f0-9-]+$/.test(value.name) ||
    (runId && value.runId !== runId)
  )
    throw new Error('DB cleanup state không hợp lệ');
  // Chỉ xóa container do verifier này tạo.
  const owner = docker([
    'inspect',
    '--format',
    `{{index .Config.Labels "${label}"}}`,
    value.name,
  ]);
  if (owner !== value.runId)
    throw new Error('Không xóa container không thuộc verifier');
  docker(['rm', '-f', value.name]);
  unlinkSync(file);
}
function sqlFile(name, file) {
  const output = docker(
    [
      'exec',
      '-i',
      name,
      'psql',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    readFileSync(file, 'utf8'),
  );
  if (output) console.log(output);
}
export async function migrations() {
  if (existsSync(stateFile)) cleanup();
  mkdirSync('.cache', { recursive: true });
  const runId = process.env.VERIFY_RUN_ID ?? randomUUID();
  const name = `vn-stock-verify-${randomUUID()}`;
  docker([
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    `${label}=${runId}`,
    '--network',
    'none',
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    image,
  ]);
  writeFileSync(stateFile, JSON.stringify({ name, runId }));
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const probe = spawnSync(
        'docker',
        ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
        { stdio: 'ignore' },
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Postgres chưa sẵn sàng');
    sqlFile(name, 'tests/database/bootstrap.sql');
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    if (!files.length) throw new Error('Không có migration');
    for (const file of files) {
      sqlFile(name, `supabase/migrations/${file}`);
      console.log(`MIGRATION PASS: ${file}`);
    }
    sqlFile(name, 'tests/database/schema.sql');
    sqlFile(name, 'tests/database/financials.sql');
    sqlFile(name, 'tests/database/review.sql');
    sqlFile(name, 'tests/database/closing.sql');
    console.log(
      `MIGRATIONS PASS: ${files.length} file SQL trên PostgreSQL 17 (auth shim; không thay thế Supabase Auth integration)`,
    );
  } catch (error) {
    cleanup();
    throw error;
  }
}
export function rls() {
  const { name } = state();
  try {
    sqlFile(name, 'tests/database/rls.sql');
    sqlFile(name, 'tests/database/rankings.sql');
    sqlFile(name, 'tests/database/news.sql');
    sqlFile(name, 'tests/database/alerts.sql');
  } finally {
    cleanup();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv[2] === 'migrations') await migrations();
    else if (process.argv[2] === 'rls') rls();
    else throw new Error('Chọn migrations hoặc rls');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
