import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const services = [
  {
    name: 'web',
    cmd: 'node',
    args: [
      'node_modules/next/dist/bin/next',
      'dev',
      'web',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ],
    url: 'http://127.0.0.1:3100',
    expected: 'Tra cứu cổ phiếu Việt Nam',
  },
  {
    name: 'worker',
    cmd: 'node',
    args: [
      'scripts/wrangler.mjs',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      '8788',
    ],
    url: 'http://127.0.0.1:8788/health',
    expected: 'Xin chào từ Workers API',
  },
];
const running = [];
try {
  // Phát hiện port đã bị chiếm; không kiểm tra nhầm dịch vụ cũ.
  for (const service of services) {
    try {
      await fetch(service.url, { signal: AbortSignal.timeout(500) });
      throw new Error(`Port cho ${service.name} đang được dùng`);
    } catch (error) {
      if (error.message.startsWith('Port cho')) throw error;
    }
    const child = spawn(service.cmd, service.args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    running.push(child);
    let passed = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (child.exitCode !== null)
        throw new Error(`${service.name} exited: ${output}`);
      try {
        const response = await fetch(service.url, {
          signal: AbortSignal.timeout(2000),
        });
        const text = await response.text();
        if (response.ok && text.includes(service.expected)) {
          passed = true;
          break;
        }
      } catch {
        /* Chờ service sẵn sàng. */
      }
      await delay(500);
    }
    if (!passed)
      throw new Error(`${service.name} không trả hello world: ${output}`);
    console.log(
      `SMOKE PASS: ${service.name}, HTTP 200, nội dung hello world đúng`,
    );
  }
  const invalid = await fetch('http://127.0.0.1:8788/v1/quotes?symbols=../');
  const missing = await fetch('http://127.0.0.1:8788/v1/quotes?symbols=ACB');
  if (invalid.status !== 400 || missing.status !== 503)
    throw new Error('Worker validation/config guard thất bại');
  console.log('SMOKE PASS: API input 400, thiếu Supabase 503');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const child of running) {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* đã dừng */
      }
    }
  }
}
