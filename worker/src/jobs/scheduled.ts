import { sampleQuotes } from '../quote-sampling';
import type { Env } from '../index';
import { serviceDatabase } from './database';
import { runJob, type JobOutcome, type Job } from './runner';
import { syncNews } from '../news/sync';
import { syncRankings } from '../ranking-sync';
import { syncMarket } from '../market-sync';
import { tradingSync } from '../trading-sync';
import { evaluateWatchlistAlerts } from '../alerts/sync';
import { deliverAlertEmails } from '../alerts/email';
import { VpsProvider } from '../../../modules/providers/vps-provider';
import { defaultHttpOptions } from '../../../modules/providers/http';
import type { SupabaseClient } from '@supabase/supabase-js';
export async function probeVps(db: SupabaseClient, timestamp: number) {
  const start = Date.now(),
    stamp = new Date(timestamp).toISOString();
  let ok = false;
  try {
    const quotes = await new VpsProvider(fetch, {
      ...defaultHttpOptions,
      retries: 1,
      timeoutMs: 5000,
    }).fetchQuotes(['ACB']);
    ok = quotes.some((q) => q.symbol === 'ACB');
  } catch {
    /* Only a fixed code goes into public status. */
  }
  const { data: previous, error: readError } = await db
    .from('api_health')
    .select('last_success_at')
    .eq('provider', 'VPS')
    .maybeSingle();
  if (readError) throw Error('Không đọc được trạng thái API');
  const { error } = await db.from('api_health').upsert({
    provider: 'VPS',
    state: ok ? 'ok' : 'degraded',
    checked_at: stamp,
    last_success_at: ok ? stamp : (previous?.last_success_at ?? null),
    latency_ms: Date.now() - start,
    code: ok ? null : 'SOURCE_UNAVAILABLE',
  });
  if (error) throw Error('Không ghi được trạng thái API');
  return {
    state: ok ? 'ok' : 'degraded',
    ...(ok ? {} : { code: 'SOURCE_UNAVAILABLE' }),
  } as JobOutcome;
}
export async function runMaintenance(env: Env, stamp: number) {
  const db = serviceDatabase(env);
  const alerts = await runJob(db, 'alerts', stamp, async () => {
    await evaluateWatchlistAlerts(db, Date.now());
    return { state: 'ok' };
  });
  const email = await runJob(db, 'email', stamp, async () => {
    const result = await deliverAlertEmails(db, env, Date.now());
    return !result.configured
      ? { state: 'skipped', code: 'EMAIL_UNCONFIGURED' }
      : result.failed
        ? { state: 'degraded', code: 'PARTIAL_SYNC' }
        : { state: 'ok' };
  });
  const vps = await runJob(db, 'vps', stamp, () => probeVps(db, Date.now()));
  return { alerts, email, vps };
}
export async function runScheduledJobs(
  cron: string,
  stamp: number,
  env: Env,
  ingest: (env: Env, stamp: number) => Promise<unknown>,
) {
  if (
    ![
      '*/5 * * * *',
      '*/30 * * * *',
      '*/5 2-8 * * 1-5',
      '* 2-8 * * 1-5',
      '15 8 * * 1-5',
      '0 9 * * 1-5',
      '30 8 * * 1-5',
    ].includes(cron)
  )
    return;
  if (cron === '*/5 * * * *') {
    const result = await runMaintenance(env, stamp);
    if (Object.values(result).some((r) => r.state === 'failed'))
      throw Error('Maintenance failed after bounded retries');
    return;
  }
  const db = serviceDatabase(env);
  let failed = false;
  const logJob = async (job: Job, work: () => Promise<JobOutcome>) => {
    const result = await runJob(db, job, stamp, work);
    failed ||= result.state === 'failed';
    return result;
  };
  if (cron === '* 2-8 * * 1-5') {
    const sampled = await logJob('prices', () => sampleQuotes(env, stamp));
    if (
      (sampled.state === 'ok' || sampled.state === 'degraded') &&
      new Date(stamp).getUTCMinutes() % 5 === 0
    )
      await logJob('rankings', async () => {
        await syncRankings(env, Date.now());
        return { state: 'ok' };
      });
  } else if (cron === '*/30 * * * *') {
    const result = await logJob('news', async () => {
      const news = await syncNews(env, stamp);
      if (news.skipped) return { state: 'skipped' };
      return news.sourceFailures
        ? { state: 'degraded', code: 'PARTIAL_SYNC' }
        : !news.llmConfigured
          ? { state: 'degraded', code: 'NEWS_LLM_UNCONFIGURED' }
          : { state: 'ok' };
    });
    if (result.state === 'ok' || result.state === 'degraded')
      await logJob('rankings', async () => {
        await syncRankings(env, Date.now());
        return { state: 'ok' };
      });
  } else if (cron === '0 9 * * 1-5') {
    const result = await logJob('market', async () => {
      if (!(await syncMarket(env, stamp)))
        return { state: 'skipped', code: 'NO_DATA' };
      const { data, error } = await db
        .from('system_status')
        .select('state')
        .eq('component', 'prices')
        .single();
      if (error) throw Error('Không đọc được kết quả đồng bộ');
      return data.state === 'ok'
        ? { state: 'ok' }
        : { state: 'degraded', code: 'PARTIAL_SYNC' };
    });
    if (result.state === 'ok' || result.state === 'degraded')
      await logJob('rankings', async () => {
        await syncRankings(env, Date.now());
        return { state: 'ok' };
      });
  } else if (cron === '30 8 * * 1-5')
    await logJob('ingest', async () => {
      const result = await ingest(env, stamp);
      return result === 'calendar_missing'
        ? { state: 'skipped', code: 'CALENDAR_MISSING' }
        : result === 'session_closed'
          ? { state: 'skipped', code: 'SESSION_CLOSED' }
          : { state: 'ok' };
    });
  else
    await logJob(cron === '15 8 * * 1-5' ? 'closing' : 'prices', async () => {
      const result = await tradingSync(env, stamp, cron === '15 8 * * 1-5');
      return result === 'calendar_missing'
        ? { state: 'skipped', code: 'CALENDAR_MISSING' }
        : result === 'session_closed'
          ? { state: 'skipped', code: 'SESSION_CLOSED' }
          : { state: 'ok' };
    });
  // Retain a bounded public operational history. Notification contents remain private.
  const { error } = await db
    .from('system_job_runs')
    .delete()
    .lt('scheduled_at', new Date(Date.now() - 30 * 86400000).toISOString());
  if (error) throw Error('Không dọn được nhật ký tác vụ');
  if (failed) throw Error('Cron failed after bounded retries');
}
