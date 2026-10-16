import type { Env } from './index';
import { serviceDatabase } from './jobs/database';
import { rankingUniverse } from '../../modules/market/ranking-universe';
import { vietnamDate } from '../../modules/market/calendar';
import { validatedSymbols } from '../../modules/providers/vps-provider';
import { liveQuotes, persistQuotes } from './live-quotes';
// Sampling is not session ingestion: no bars, scores, finality or calendar is inferred.
// Missing calendar may prevent verified session jobs, but must not freeze display snapshots.
export async function sampleQuotes(env: Env, stamp: number) {
  const local = new Date(stamp + 7 * 3600000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (
    [0, 6].includes(local.getUTCDay()) ||
    minute < 540 ||
    minute > 900 ||
    (minute > 690 && minute < 780)
  )
    return { state: 'skipped' as const, code: 'SESSION_CLOSED' as const };
  const db = serviceDatabase(env);
  const { data: session, error } = await db
    .from('trading_sessions')
    .select('is_open')
    .eq('session_date', vietnamDate(stamp))
    .maybeSingle();
  if (error) throw Error('Không đọc được lịch');
  if (session?.is_open === false)
    return { state: 'skipped' as const, code: 'SESSION_CLOSED' as const };
  const symbols = validatedSymbols(
    (env.SYNC_SYMBOLS || rankingUniverse).split(','),
  );
  const { data: stocks, error: stockError } = await db
    .from('stocks')
    .select('symbol')
    .eq('active', true)
    .in('symbol', symbols);
  if (stockError || !stocks?.length) throw Error('Danh mục snapshot rỗng');
  let imported = 0,
    failed = 0;
  for (let offset = 0; offset < stocks.length; offset += 10) {
    try {
      const quotes = await liveQuotes(
        stocks.slice(offset, offset + 10).map((s) => String(s.symbol)),
      );
      await persistQuotes(db, quotes);
      imported += quotes.length;
    } catch {
      failed++;
    }
  }
  if (!imported)
    throw Error('Không nhận được snapshot hợp lệ; giữ dữ liệu cũ.');
  const now = new Date().toISOString();
  const { error: statusError } = await db.from('system_status').upsert({
    component: 'prices',
    state: session && !failed ? 'ok' : 'degraded',
    last_success_at: now,
    updated_at: now,
  });
  if (statusError) throw Error('Không lưu được trạng thái giá');
  if (failed)
    return { state: 'degraded' as const, code: 'PARTIAL_SYNC' as const };
  return session
    ? { state: 'ok' as const }
    : { state: 'degraded' as const, code: 'CALENDAR_MISSING' as const };
}
