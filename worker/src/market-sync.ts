import { rankingUniverse } from '../../modules/market/ranking-universe';
import { syncMetadata } from './metadata-sync';
import { syncFinancials } from './financial-sync';
import { createClient } from '@supabase/supabase-js';
import type { Env } from './index';
import deployment from '../../config/public-deployment.json';
import { marketProviders } from './api/market';
import { normalizeSearch } from '../../modules/market/search';
import {
  canIngest,
  vietnamDate,
  yearsBefore,
} from '../../modules/market/calendar';
import { validatedSymbols } from '../../modules/providers/vps-provider';

export async function syncMarket(
  env: Env,
  timestamp?: number,
): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu quyền đồng bộ thị trường');
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  if (timestamp !== undefined) {
    const { data: session, error: sessionError } = await db
      .from('trading_sessions')
      .select('session_date,is_open,closes_at')
      .eq('session_date', vietnamDate(timestamp))
      .maybeSingle();
    if (sessionError) throw new Error('Không đọc được lịch phiên');
    if (!canIngest(session, timestamp)) return false;
  }
  const provider = marketProviders(env);
  const stocks = await provider.catalog.fetchStocks();
  if (stocks.length < 100) throw new Error('Catalog không đầy đủ');
  const { error: catalogError } = await db.rpc('reconcile_stock_catalog', {
    rows: stocks.map((s) => ({
      ...s,
      search_text: normalizeSearch(s.symbol + ' ' + s.name),
    })),
    complete: true,
    observed_at: stocks[0]!.fetchedAt,
  });
  if (catalogError)
    throw new Error(
      'Danh mục không đủ bằng chứng đối soát; không vô hiệu hóa mã',
    );
  const symbols = validatedSymbols(
    (env.SYNC_SYMBOLS || rankingUniverse).split(','),
  );
  const today = vietnamDate(Date.now());
  let failedHistory = 0;
  for (const symbol of symbols) {
    try {
      const { data: stock, error } = await db
        .from('stocks')
        .select('id')
        .eq('symbol', symbol)
        .eq('active', true)
        .maybeSingle();
      if (error || !stock) throw new Error('Mã đồng bộ không hợp lệ');
      const bars = await provider.history.fetchHistory(
        symbol,
        yearsBefore(today, 3),
        today,
      );
      if (!bars.length)
        throw new Error('Nguồn lịch sử không có dữ liệu cho mã đồng bộ');
      const { error: writeError } = await db.rpc('ingest_price_history', {
        rows: bars.map((b) => ({
          stock_id: stock.id,
          session_date: b.sessionDate,
          source: b.source,
          open_vnd: b.openVnd,
          high_vnd: b.highVnd,
          low_vnd: b.lowVnd,
          close_vnd: b.closeVnd,
          volume_reported: b.volumeReported,
          is_final: b.isFinal,
          fetched_at: b.fetchedAt,
        })),
      });
      if (writeError) throw new Error('Không ghi được history');
    } catch {
      failedHistory++;
      console.warn(`History SYNC FAIL: ${symbol}; giữ dữ liệu cũ`);
    }
  }
  let failedQuotes = false;
  try {
    const quotes = await provider.quotes.fetchQuotes(symbols);
    const { error } = await db.rpc('ingest_current_quotes', {
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
    if (error) throw new Error('Không ghi được quotes');
  } catch {
    failedQuotes = true;
    console.warn('VPS quotes lỗi; giữ dữ liệu cũ và tham chiếu KBS có nhãn.');
  }
  await syncFinancials(env);
  await syncMetadata(env);
  const { error: statusError } = await db.from('system_status').upsert({
    component: 'prices',
    state: failedHistory || failedQuotes ? 'degraded' : 'ok',
    last_success_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (statusError) throw new Error('Không cập nhật trạng thái');
  return true;
}
