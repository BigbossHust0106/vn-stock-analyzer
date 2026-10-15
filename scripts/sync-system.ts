import { createHmac } from 'node:crypto';
import { managementClient } from './sync-rankings';
import { migrateHosted } from './management';
import { runMaintenance } from '../worker/src/jobs/scheduled';
import deployment from '../config/public-deployment.json';
if (process.argv.includes('--migrate')) await migrateHosted();
const { key, url } = await managementClient();
if (process.argv.includes('--production')) {
  const stamp = String(Date.now()),
    signature = createHmac('sha256', key)
      .update(stamp + ':POST:/v1/internal/system-sync')
      .digest('hex');
  const r = await fetch(deployment.workerUrl + '/v1/internal/system-sync', {
    method: 'POST',
    headers: { 'X-Job-Timestamp': stamp, 'X-Job-Signature': signature },
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok)
    throw Error(
      'System sync HTTP ' + r.status + '; xem nhật ký an toàn trong app',
    );
  console.log('SYSTEM PRODUCTION SYNC:', JSON.stringify(await r.json()));
} else {
  const result = await runMaintenance(
    {
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      ...(process.env.ALERT_EMAIL_API_KEY
        ? { ALERT_EMAIL_API_KEY: process.env.ALERT_EMAIL_API_KEY }
        : {}),
      ...(process.env.ALERT_EMAIL_FROM
        ? { ALERT_EMAIL_FROM: process.env.ALERT_EMAIL_FROM }
        : {}),
    },
    Date.now(),
  );
  console.log('SYSTEM SYNC:', JSON.stringify(result));
  if (Object.values(result).some((r) => r.state === 'failed'))
    throw Error('System job failed; xem nhật ký an toàn trong app');
}
