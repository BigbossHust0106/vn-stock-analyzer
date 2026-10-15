import { createHmac } from 'node:crypto';
import { managementClient } from './sync-rankings';
import { collectNews } from '../worker/src/news/sync';
import { syncRankings } from '../worker/src/ranking-sync';
import { migrateHosted } from './management';
import deployment from '../config/public-deployment.json';
if (process.argv.includes('--migrate')) await migrateHosted();
const { db, key, url } = await managementClient();
if (process.argv.includes('--production')) {
  const stamp = String(Date.now()),
    signature = createHmac('sha256', key)
      .update(stamp + ':POST:/v1/internal/news-sync')
      .digest('hex');
  const response = await fetch(
    deployment.workerUrl + '/v1/internal/news-sync',
    {
      method: 'POST',
      headers: { 'X-News-Timestamp': stamp, 'X-News-Signature': signature },
      signal: AbortSignal.timeout(600000),
    },
  );
  if (!response.ok)
    throw Error(
      'Production news sync HTTP ' +
        response.status +
        '; không in credential/phản hồi nhà cung cấp',
    );
  const result = (await response.json()) as { result: unknown };
  console.log('PRODUCTION NEWS SYNC:', JSON.stringify(result.result));
} else {
  const env = {
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    NEWS_RSS_PERMISSION:
      process.env.NEWS_RSS_PERMISSION ?? 'personal-nonprofit',
    ...(process.env.NEWS_LLM_API_KEY
      ? { NEWS_LLM_API_KEY: process.env.NEWS_LLM_API_KEY }
      : {}),
    ...(process.env.NEWS_LLM_BASE_URL
      ? { NEWS_LLM_BASE_URL: process.env.NEWS_LLM_BASE_URL }
      : {}),
    ...(process.env.NEWS_LLM_MODEL
      ? { NEWS_LLM_MODEL: process.env.NEWS_LLM_MODEL }
      : {}),
  };
  console.log(
    'NEWS SYNC:',
    JSON.stringify(await collectNews(db, env, Date.now())),
  );
  await syncRankings(env, Date.now());
  console.log(
    'NEWS RANKINGS PASS: three horizons refreshed without relaxing evidence policy',
  );
}
