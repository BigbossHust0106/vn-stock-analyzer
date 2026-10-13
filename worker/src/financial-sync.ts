import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import deployment from '../../config/public-deployment.json';
import { marketProviders } from './api/market';
import { validatedSymbols } from '../../modules/providers/vps-provider';
import type { FinancialData } from '../../modules/providers/financial-types';
import type { ScoreReport } from '../../modules/scoring/engine';
import { scoreStock } from '../../modules/scoring/engine';
import { vietnamDate } from '../../modules/market/calendar';
export function defaultScoreRow(
  stockId: string,
  financials: FinancialData,
  report: ScoreReport,
) {
  return {
    stock_id: stockId,
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
): Promise<void> {
  const { error } = await db.rpc('ingest_financials', { dataset: financials });
  if (error) throw new Error('Không ghi được BCTC');
  const { error: scoreError } = await db
    .from('scores')
    .upsert(defaultScoreRow(stockId, financials, report), {
      onConflict: 'stock_id,as_of,horizon,model_version',
    });
  if (scoreError) throw new Error('Không ghi được điểm');
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
  for (const symbol of validatedSymbols(
    (env.SYNC_SYMBOLS || 'VNM,FPT,HPG').split(','),
  )) {
    const { data: stock, error } = await db
      .from('stocks')
      .select('id')
      .eq('symbol', symbol)
      .eq('active', true)
      .maybeSingle();
    if (error || !stock) throw new Error('Mã BCTC không thuộc catalog');
    const financials = await provider.fundamentals.fetchFinancials(symbol);
    if (financials.supported && !financials.annual.length)
      throw new Error('Nguồn BCTC không có kỳ năm hợp lệ');
    const { data: quote, error: readError } = await db
      .from('prices_current')
      .select('last_price_vnd,fetched_at')
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
    await persistFinancials(db, stock.id, financials, report);
  }
  const { error } = await db.from('system_status').upsert({
    component: 'fundamentals',
    state: 'ok',
    last_success_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error('Không cập nhật được trạng thái BCTC');
}
