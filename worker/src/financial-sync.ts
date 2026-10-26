import { financialTurn } from './financial-catalog';
import { ioPolicy } from '../../modules/market/io-policy';
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
        .select('id,financial_snapshots(fetched_at)')
        .eq('symbol', symbol)
        .eq('active', true)
        .maybeSingle();
      if (error || !stock) throw new Error('Mã BCTC không thuộc catalog');
      const existing = stock.financial_snapshots as unknown as {
        fetched_at?: string;
      } | null;
      if (
        existing?.fetched_at &&
        Date.now() - Date.parse(existing.fetched_at) <= financialMaxAgeMs
      )
        continue;
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
  if (!synced && !failed) return;
  await writeFundamentalsStatus(db, !failed, synced > 0);
  if (!synced) throw new Error('Không cập nhật được BCTC cho mã nào');
}
// > 24 giờ cache trong isolate của KbsProvider, để lượt làm mới luôn gọi nguồn thật
// thay vì ghi lại bản cache cũ.
export const financialMaxAgeMs = ioPolicy.financialMaxAgeMs;
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
// One symbol per five-minute turn. Ring position is stable even if a source fails;
// fresh symbols do no provider requests/writes. Missing symbols remain discoverable.
export async function refreshStaleFinancials(env: Env, timestamp: number) {
  const db = serviceClient(env);
  const stock = await financialTurn(db, timestamp);
  const result: { refreshed: string[]; failed: string[]; pending: null } = {
    refreshed: [],
    failed: [],
    pending: null,
  };
  if (
    !stock ||
    (stock.fetchedAt &&
      timestamp - Date.parse(stock.fetchedAt) <= financialMaxAgeMs)
  )
    return result;
  try {
    await syncFinancialSymbol(db, env, stock.id, stock.symbol);
    result.refreshed.push(stock.symbol);
  } catch {
    result.failed.push(stock.symbol);
  }
  await writeFundamentalsStatus(
    db,
    !result.failed.length,
    !!result.refreshed.length,
  );
  return result;
}
