import { createClient } from '@supabase/supabase-js';
import type { Env } from './index';
import deployment from '../../config/public-deployment.json';
import { vietnamDate, canIngest } from '../../modules/market/calendar';
import { inTradingHours } from '../../modules/market/trading-hours';
import type { Exchange } from '../../modules/providers/data-provider';
import { marketProviders } from './api/market';
import { syncMarket } from './market-sync';
import { syncRankings } from './ranking-sync';
export async function tradingSync(
  env: Env,
  timestamp: number,
  closing = false,
) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu quyền đồng bộ giá');
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: session, error } = await db
    .from('trading_sessions')
    .select('session_date,is_open,closes_at')
    .eq('session_date', vietnamDate(timestamp))
    .maybeSingle();
  if (error) throw new Error('Không đọc được lịch giao dịch');
  if (
    closing
      ? !canIngest(session, timestamp)
      : !inTradingHours(session, timestamp, 'UPCOM')
  ) {
    if (!session)
      console.warn('Thiếu lịch phiên có nguồn; bỏ cập nhật/chốt giá.');
    return;
  }
  const provider = marketProviders(env);
  let imported = 0;
  for (let start = 0; ; start += 1000) {
    const { data: stocks, error: stockError } = await db
      .from('stocks')
      .select('symbol,exchange')
      .eq('active', true)
      .order('symbol')
      .range(start, start + 999);
    if (stockError || !stocks) throw new Error('Không đọc được danh mục');
    const allowed = stocks.filter(
      (s) =>
        closing || inTradingHours(session, timestamp, s.exchange as Exchange),
    );
    for (let offset = 0; offset < allowed.length; offset += 50) {
      const quotes = await provider.quotes.fetchQuotes(
        allowed.slice(offset, offset + 50).map((s) => s.symbol as string),
      );
      const { error: writeError } = await db.rpc('ingest_current_quotes', {
        rows: quotes.map((q) => ({
          symbol: q.symbol,
          reference_vnd: q.referenceVnd,
          ceiling_vnd: q.ceilingVnd,
          floor_vnd: q.floorVnd,
          last_price_vnd: q.lastPriceVnd,
          bid3_price_vnd: q.bid3PriceVnd,
          last_volume_raw: q.volumeRaw.lastVolume,
          lot_raw: q.volumeRaw.lot,
          fetched_at: q.fetchedAt,
        })),
      });
      if (writeError) throw new Error('Không ghi được giá trong phiên');
      imported += quotes.length;
    }
    if (stocks.length < 1000) break;
  }
  if (!imported) throw new Error('Danh mục giao dịch rỗng; không ghi success');
  if (closing) {
    await syncMarket(env, timestamp);
    // Downloading after the close does not prove source finality or price basis.
    // Keep provider bars unverified; never promote fetchedAt to source evidence.
    await syncRankings(env, timestamp);
  }
  const { error: statusError } = await db.from('system_status').upsert({
    component: 'prices',
    state: 'ok',
    last_success_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (statusError) throw new Error('Không cập nhật được trạng thái giá');
}
