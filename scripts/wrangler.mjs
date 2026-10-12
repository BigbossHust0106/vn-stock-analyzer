import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = `${root}/.cache/xdg`;
mkdirSync(config, { recursive: true });
const child = spawn(
  fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  ),
  process.argv.slice(2),
  {
    cwd: fileURLToPath(new URL('../worker', import.meta.url)),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: config,
      WRANGLER_SEND_METRICS: 'false',
    },
    stdio: 'inherit',
  },
);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
