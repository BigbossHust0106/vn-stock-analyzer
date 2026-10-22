import { financialCatalog } from './financial-catalog';
import { syncFinancialBackup } from './financial-backup';
import { rankingUniverse } from '../../modules/market/ranking-universe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import deployment from '../../config/public-deployment.json';
import { marketProviders } from './api/market';
import { validatedSymbols } from '../../modules/providers/vps-provider';
import {
  financialRegression,
  type FinancialData,
} from '../../modules/providers/financial-types';
import type { ScoreReport } from '../../modules/scoring/engine';
import { scoreStock } from '../../modules/scoring/engine';
import { vietnamDate } from '../../modules/market/calendar';
export function defaultScoreRow(
  stockId: string,
  financials: FinancialData,
  report: ScoreReport,
  quoteVersion: string | null = null,
) {
  return {
    stock_id: stockId,
    quote_version: quoteVersion,
    as_of: vietnamDate(Date.parse(report.asOf)),
    horizon: 'month',
    model_version: report.modelVersion,
    value: report.score,
    insufficient_reason: report.score === null ? 'không đủ dữ liệu' : null,
    inputs_as_of: financials.fetchedAt,
    computed_at: report.asOf,
    explanation: report,
  };
}
export async function persistFinancials(
  db: SupabaseClient,
  stockId: string,
  financials: FinancialData,
  report: ScoreReport,
  quoteVersion: string | null = null,
): Promise<void> {
  const { error } = await db.rpc('persist_financial_score', {
    dataset: financials,
    score_record: defaultScoreRow(stockId, financials, report, quoteVersion),
  });
  if (error)
    throw new Error(
      'Không lưu được BCTC và điểm nguyên tử; kiểm tra phiên bản nguồn/quote',
    );
}
function serviceClient(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu quyền đồng bộ BCTC');
  return createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
// Một mã: tải nguồn chính, chặn snapshot suy giảm, lưu BCTC + điểm nguyên tử.
export async function syncFinancialSymbol(
  db: SupabaseClient,
  env: Env,
  stockId: string,
  symbol: string,
): Promise<number> {
  const financials =
    await marketProviders(env).fundamentals.fetchFinancials(symbol);
  const { data: previous, error: previousError } = await db
    .from('financial_snapshots')
    .select('payload')
    .eq('stock_id', stockId)
    .maybeSingle();
  if (previousError) throw new Error('Không đọc được snapshot BCTC');
  if (previous && financialRegression(previous.payload, financials))
    throw new Error('BCTC mới thiếu dữ liệu, giữ snapshot và điểm cũ');
  if (financials.supported && !financials.annual.length)
    throw new Error('Nguồn BCTC không có kỳ năm hợp lệ');
  const { data: quote, error: readError } = await db
    .from('prices_current')
    .select('last_price_vnd,fetched_at,version')
    .eq('stock_id', stockId)
    .maybeSingle();
  if (readError) throw new Error('Không đọc được giá chấm điểm');
  const report = scoreStock(
    financials,
    quote?.last_price_vnd ?? null,
    new Date().toISOString(),
    undefined,
    quote?.fetched_at ?? null,
  );
  await persistFinancials(
    db,
    stockId,
    financials,
    report,
    quote?.version ?? null,
  );
  return financials.annual.length;
}
async function writeFundamentalsStatus(
  db: SupabaseClient,
  ok: boolean,
  synced: boolean,
) {
  const { error } = await db.from('system_status').upsert({
    component: 'fundamentals',
    state: ok ? 'ok' : 'degraded',
    ...(synced ? { last_success_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error('Không cập nhật được trạng thái BCTC');
}
export async function syncFinancials(env: Env): Promise<void> {
  const db = serviceClient(env);
  let synced = 0,
    failed = 0;
  for (const symbol of validatedSymbols(
    (env.SYNC_SYMBOLS || rankingUniverse).split(','),
  )) {
    try {
      const { data: stock, error } = await db
        .from('stocks')
        .select('id')
        .eq('symbol', symbol)
        .eq('active', true)
        .maybeSingle();
      if (error || !stock) throw new Error('Mã BCTC không thuộc catalog');
      // Independent source archive: errors never erase the good normalized snapshot.
      await syncFinancialBackup(db, stock.id, symbol).catch(() =>
        console.warn(`BCTC BACKUP FAIL: ${symbol}; giữ bản cũ`),
      );
      const years = await syncFinancialSymbol(db, env, stock.id, symbol);
      synced++;
      console.log(`BCTC SYNC: ${symbol}, ${years} kỳ năm thật`);
    } catch {
      failed++;
      console.warn(
        `BCTC SYNC FAIL: ${symbol}; giữ dữ liệu cũ, không bịa đầu vào`,
      );
    }
  }
  await writeFundamentalsStatus(db, !failed, synced > 0);
  if (!synced) throw new Error('Không cập nhật được BCTC cho mã nào');
}
// > 24 giờ cache trong isolate của KbsProvider, để lượt làm mới luôn gọi nguồn thật
// thay vì ghi lại bản cache cũ.
export const financialMaxAgeMs = 25 * 3600000;
// Chọn mã cần làm mới: chưa có snapshot trước, sau đó snapshot cũ nhất. Xoay vòng
// theo phút để một mã lỗi không cố định ở đầu hàng; không giới hạn theo rankingUniverse.
export function staleFinancialSymbols(
  stocks: { id: string; symbol: string }[],
  fetched: Map<string, string>,
  timestamp: number,
  maxAgeMs = financialMaxAgeMs,
): { id: string; symbol: string }[] {
  const age = (id: string) => {
    const at = Date.parse(fetched.get(id) ?? '');
    return Number.isFinite(at) ? timestamp - at : Infinity;
  };
  const stale = stocks
    .filter((s) => age(s.id) > maxAgeMs)
    .sort((a, b) => age(b.id) - age(a.id) || a.symbol.localeCompare(b.symbol));
  if (!stale.length) return [];
  const turn = Math.floor(timestamp / 60000) % stale.length;
  return [...stale.slice(turn), ...stale.slice(0, turn)];
}
// Cron BCTC độc lập lịch phiên: BCTC không phụ thuộc ngày giao dịch. Mỗi phút chỉ
// làm mới `limit` mã để nằm trong ngân sách subrequest/CPU của Workers Free.
export async function refreshStaleFinancials(
  env: Env,
  timestamp: number,
  limit = 1,
): Promise<{ refreshed: string[]; failed: string[]; pending: number }> {
  const db = serviceClient(env);
  const { stocks, fetched } = await financialCatalog(db);
  const queue = staleFinancialSymbols(
    stocks.map((s) => ({ id: String(s.id), symbol: String(s.symbol) })),
    fetched,
    timestamp,
  );
  const refreshed: string[] = [],
    failed: string[] = [];
  for (const stock of queue.slice(0, limit)) {
    try {
      const years = await syncFinancialSymbol(db, env, stock.id, stock.symbol);
      refreshed.push(stock.symbol);
      console.log(`BCTC REFRESH: ${stock.symbol}, ${years} kỳ năm`);
    } catch {
      failed.push(stock.symbol);
      console.warn(`BCTC REFRESH FAIL: ${stock.symbol}; giữ snapshot cũ`);
    }
  }
  // Khi BCTC chuẩn hóa đã mới, dùng lượt rảnh để làm mới kho dự phòng Vietcap.
  if (!queue.length) {
    const { data: backups, error: backupError } = await db
      .from('financial_report_backups')
      .select('stock_id,fetched_at')
      .eq('source', 'VIETCAP_REPORTS');
    if (!backupError && Array.isArray(backups)) {
      const next = staleFinancialSymbols(
        stocks.map((s) => ({ id: String(s.id), symbol: String(s.symbol) })),
        new Map(backups.map((b) => [String(b.stock_id), String(b.fetched_at)])),
        timestamp,
        86400000,
      )[0];
      if (next)
        await syncFinancialBackup(db, next.id, next.symbol).catch(() =>
          console.warn(`BCTC BACKUP FAIL: ${next.symbol}; giữ bản cũ`),
        );
    }
  }
  if (refreshed.length || failed.length)
    await writeFundamentalsStatus(db, !failed.length, refreshed.length > 0);
  return {
    refreshed,
    failed,
    pending: Math.max(0, queue.length - refreshed.length),
  };
}
