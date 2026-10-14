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
export async function syncFinancials(env: Env): Promise<void> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu quyền đồng bộ BCTC');
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const provider = marketProviders(env);
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
      const financials = await provider.fundamentals.fetchFinancials(symbol);
      const { data: previous, error: previousError } = await db
        .from('financial_snapshots')
        .select('payload')
        .eq('stock_id', stock.id)
        .maybeSingle();
      if (previousError) throw new Error('Không đọc được snapshot BCTC');
      if (previous && financialRegression(previous.payload, financials))
        throw new Error('BCTC mới thiếu dữ liệu, giữ snapshot và điểm cũ');
      if (financials.supported && !financials.annual.length)
        throw new Error('Nguồn BCTC không có kỳ năm hợp lệ');
      const { data: quote, error: readError } = await db
        .from('prices_current')
        .select('last_price_vnd,fetched_at,version')
        .eq('stock_id', stock.id)
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
        stock.id,
        financials,
        report,
        quote?.version ?? null,
      );
      synced++;
      console.log(
        `BCTC SYNC: ${symbol}, ${financials.annual.length} kỳ năm thật`,
      );
    } catch {
      failed++;
      console.warn(
        `BCTC SYNC FAIL: ${symbol}; giữ dữ liệu cũ, không bịa đầu vào`,
      );
    }
  }
  const { error } = await db.from('system_status').upsert({
    component: 'fundamentals',
    state: failed ? 'degraded' : 'ok',
    ...(synced ? { last_success_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error('Không cập nhật được trạng thái BCTC');
  if (!synced) throw new Error('Không cập nhật được BCTC cho mã nào');
}
