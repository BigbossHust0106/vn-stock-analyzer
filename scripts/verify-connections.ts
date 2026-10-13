import deployment from '../config/public-deployment.json';
import { checkConnections } from '../web/lib/connections';

const checks = await checkConnections(
  {
    workerUrl: process.env.NEXT_PUBLIC_WORKER_URL || deployment.workerUrl,
    ...(process.env.NEXT_PUBLIC_SUPABASE_URL
      ? { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }
      : {}),
    ...(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ? {
          supabasePublishableKey:
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        }
      : {}),
  },
  (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', 'vn-stock-analyzer/0.1 connection-check');
    return fetch(input, { ...init, headers });
  },
);
console.log('| Kết nối | Kết quả | Chi tiết |');
console.log('| --- | --- | --- |');
for (const check of checks)
  console.log(
    `| ${check.name} | ${check.ok ? 'PASS' : 'FAIL'} | ${check.message} |`,
  );
process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
