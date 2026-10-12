import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const binary = '.tools/gitleaks';
if (!existsSync(binary))
  throw new Error('Thiếu Gitleaks: npm run tools:install');
// Quét source tracked + untracked không bị ignore; vẫn bắt file secret bị force-add.
// Không quét node_modules hay .dev.vars local đã bị Git ignore.
const source = mkdtempSync(join(tmpdir(), 'vn-stock-secrets-'));
try {
  const files = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  if (files.error || files.status !== 0)
    throw new Error('Không liệt kê được source để quét');
  for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
    if (!existsSync(file)) continue;
    const destination = join(source, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }
  for (const args of [
    ['dir', source, '--config', '.gitleaks.toml', '--redact', '--no-banner'],
    [
      'git',
      '.',
      '--log-opts=--all',
      '--config',
      '.gitleaks.toml',
      '--redact',
      '--no-banner',
    ],
  ]) {
    const result = spawnSync(binary, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(source, { recursive: true, force: true });
}
