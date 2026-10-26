import { ioPolicy, observationWindow } from '../../../modules/market/io-policy';
import { emailConfigured } from '../alerts/email';
import { sampleQuotes } from '../quote-sampling';
import type { Env } from '../index';
import { serviceDatabase } from './database';
import { runJob, type JobOutcome, type Job } from './runner';
import { syncNews } from '../news/sync';
import { syncRankings } from '../ranking-sync';
import { syncMarket, refreshCatalogIfStale } from '../market-sync';
import { refreshStaleFinancials } from '../financial-sync';
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
  const email = emailConfigured(env)
    ? await runJob(db, 'email', stamp, async () => {
        const result = await deliverAlertEmails(db, env, Date.now());
        return !result.configured
          ? { state: 'skipped', code: 'EMAIL_UNCONFIGURED' }
          : result.failed
            ? { state: 'degraded', code: 'PARTIAL_SYNC' }
            : { state: 'ok' };
      })
    : { state: 'skipped' as const, code: 'EMAIL_UNCONFIGURED' as const };
  const vps =
    new Date(stamp).getUTCMinutes() % 15 === 0
      ? await runJob(db, 'vps', stamp, () => probeVps(db, Date.now()))
      : { state: 'skipped' as const };
  const catalog =
    env.PAUSE_BULK_SYNC === 'true'
      ? { state: 'skipped' as const }
      : await refreshCatalogIfStale(db, env, stamp).catch(() => ({
          state: 'degraded' as const,
        }));
  // Chạy cuối: lỗi/giới hạn subrequest của bước BCTC không ảnh hưởng cảnh báo/VPS.
  const financials =
    env.PAUSE_BULK_SYNC === 'true'
      ? { state: 'skipped' as const }
      : await refreshStaleFinancials(env, stamp)
          .then((r) => ({
            state: r.failed.length ? ('degraded' as const) : ('ok' as const),
            ...r,
          }))
          .catch(() => {
            console.warn(
              'BCTC REFRESH SKIPPED: chưa đọc/ghi được trạng thái BCTC',
            );
            return { state: 'skipped' as const };
          });
  if (
    new Date(stamp).getUTCHours() === 0 &&
    new Date(stamp).getUTCMinutes() === 0
  ) {
    const r = await db
      .from('system_job_runs')
      .delete()
      .lt('scheduled_at', new Date(stamp - 30 * 86400000).toISOString());
    if (r.error) throw Error('Không dọn được nhật ký');
  }
  return { alerts, email, vps, catalog, financials };
}
export async function runScheduledJobs(
  cron: string,
  stamp: number,
  env: Env,
  ingest: (env: Env, stamp: number) => Promise<unknown>,
) {
  if (
    ![
      '* * * * *',
      '*/5 * * * *',
      '0 * * * *',
      '*/30 * * * *',
      '*/5 2-8 * * 1-5',
      '* 2-8 * * 1-5',
      '15 8 * * 1-5',
      '0 9 * * 1-5',
      '30 8 * * 1-5',
    ].includes(cron)
  )
    return;
  // Also gate obsolete deployed triggers before any DB call while cron changes propagate.
  const minute = new Date(stamp).getUTCMinutes();
  if (
    env.PAUSE_BULK_SYNC === 'true' &&
    ['*/30 * * * *', '0 * * * *', '0 9 * * 1-5'].includes(cron)
  )
    return;
  if (cron === '* * * * *' && minute % ioPolicy.maintenanceMinutes !== 0)
    return;
  if (cron === '*/30 * * * *' && minute !== 0) return;
  if (cron === '* 2-8 * * 1-5' && !observationWindow(stamp)) return;
  if (cron === '*/5 * * * *' || cron === '* * * * *') {
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
      env.PAUSE_BULK_SYNC !== 'true' &&
      (sampled.state === 'ok' || sampled.state === 'degraded') &&
      new Date(stamp).getUTCMinutes() % ioPolicy.rankingMinutes === 0
    )
      await logJob('rankings', async () => {
        await syncRankings(env, Date.now());
        return { state: 'ok' };
      });
  } else if (cron === '0 * * * *' || cron === '*/30 * * * *') {
    await logJob('news', async () => {
      const news = await syncNews(env, stamp);
      if (news.skipped) return { state: 'skipped' };
      return news.sourceFailures
        ? { state: 'degraded', code: 'PARTIAL_SYNC' }
        : !news.llmConfigured
          ? { state: 'degraded', code: 'NEWS_LLM_UNCONFIGURED' }
          : { state: 'ok' };
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
  if (failed) throw Error('Cron failed after bounded retries');
}
