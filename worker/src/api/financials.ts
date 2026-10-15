import { persistFinancials } from '../financial-sync';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { marketProviders } from './market';
import { symbolValue } from '../../../modules/providers/market-schema';
import {
  financialRegression,
  isFinancialData,
  type FinancialData,
} from '../../../modules/providers/financial-types';
import { scoreStock } from '../../../modules/scoring/engine';
export async function financialResponse(
  request: Request,
  env: Env,
  context?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/v1/financials/')) return null;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  };
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  const symbol = path.slice('/v1/financials/'.length);
  try {
    symbolValue(symbol);
  } catch {
    return reply({ error: 'Mã không hợp lệ' }, 400);
  }
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: 'Nguồn BCTC chưa cấu hình' }, 503);
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const { data: stock, error } = await db
      .from('stocks')
      .select('id')
      .eq('symbol', symbol)
      .eq('active', true)
      .maybeSingle();
    if (error) throw new Error('Database');
    if (!stock) return reply({ error: 'Không tìm thấy mã' }, 404);
    const { data: stored, error: readError } = await db
      .from('financial_snapshots')
      .select('payload,fetched_at')
      .eq('stock_id', stock.id)
      .maybeSingle();
    if (readError) throw new Error('Migration missing');
    if (
      stored &&
      (!isFinancialData(stored.payload) || stored.payload.symbol !== symbol)
    )
      throw new Error('Invalid stored financials');
    let financials: FinancialData | null = stored?.payload ?? null;
    const notices: string[] = [];
    if (!stored || Date.now() - Date.parse(stored.fetched_at) > 86400000) {
      try {
        const candidate =
          await marketProviders(env).fundamentals.fetchFinancials(symbol);
        if (financialRegression(financials, candidate))
          notices.push(
            'BCTC mới thiếu dữ liệu so với bản đã lưu; giữ snapshot tốt, không ghi đè.',
          );
        else financials = candidate;
      } catch {
        notices.push(
          financials
            ? 'Nguồn BCTC đang lỗi; dùng dữ liệu đã lưu, xem thời điểm nhận.'
            : 'Không lấy được BCTC; tiêu chí thiếu không được tự điền.',
        );
      }
    }
    const { data: quote, error: quoteError } = await db
      .from('prices_current')
      .select('last_price_vnd,fetched_at,version')
      .eq('stock_id', stock.id)
      .maybeSingle();
    if (quoteError) throw new Error('Quote read unavailable');
    const asOf = new Date().toISOString();
    const report = scoreStock(
      financials,
      quote?.last_price_vnd ?? null,
      asOf,
      undefined,
      quote?.fetched_at ?? null,
    );
    if (financials && env.SUPABASE_SERVICE_ROLE_KEY && context) {
      const writer = createClient(
        env.SUPABASE_URL || deployment.supabaseUrl,
        env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      context.waitUntil(
        persistFinancials(
          writer,
          stock.id,
          financials,
          report,
          quote?.version ?? null,
        ).catch(() => {
          console.error(
            'Không lưu được BCTC/điểm mặc định; kiểm tra migration/quyền.',
          );
        }),
      );
    }
    const { data: backups, error: backupError } = await db
      .from('financial_report_backups')
      .select('source,fetched_at,last_error')
      .eq('stock_id', stock.id);
    if (backupError)
      notices.push('Chưa đọc được trạng thái nguồn BCTC dự phòng.');
    return reply({
      backups: backups ?? [],
      financials,
      report,
      notices,
      disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
    });
  } catch {
    return reply(
      { error: 'Không đọc được BCTC; kiểm tra migration/provider' },
      502,
    );
  }
}
