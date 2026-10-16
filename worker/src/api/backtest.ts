import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import {
  evaluateCohort,
  priceReturn,
  type Cohort,
  type Holding,
  type ReturnLeg,
} from '../../../modules/backtest/returns';
import { validSourceDate } from '../../../modules/providers/source-evidence';
export async function backtestResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/backtest') return null;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  };
  const query = url.searchParams;
  const horizon = query.get('horizon') ?? 'day',
    mode = query.get('mode') ?? 'history';
  const before = query.get('before'),
    id = query.get('id');
  const symbol = query.get('symbol') ?? 'DPR',
    start = query.get('start'),
    source = query.get('source') ?? 'VPS';
  if (
    [...query.keys()].some(
      (k) =>
        ![
          'horizon',
          'mode',
          'before',
          'id',
          'symbol',
          'start',
          'source',
        ].includes(k) || query.getAll(k).length !== 1,
    ) ||
    !['day', 'month', 'quarter'].includes(horizon) ||
    !['history', 'prices'].includes(mode) ||
    (before === null) !== (id === null) ||
    (before !== null &&
      (!Number.isFinite(Date.parse(before)) ||
        !validSourceDate(before.slice(0, 10)) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          before,
        ))) ||
    (id !== null &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )) ||
    (mode === 'prices' &&
      (!/^[A-Z0-9]{3,12}$/.test(symbol) ||
        !start ||
        !validSourceDate(start) ||
        !['VPS', 'KBS'].includes(source)))
  )
    return Response.json(
      { error: 'Bộ lọc backtest không hợp lệ.' },
      { status: 400, headers: { ...headers, 'Cache-Control': 'no-store' } },
    );
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json({ error: 'Chưa cấu hình dữ liệu.' }, { status: 503 });
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    if (mode === 'prices') {
      const { data, error } = await db.rpc('reported_price_check', {
        ticker: symbol,
        start_day: start,
        provider: source,
      });
      if (error || !data) throw Error('Read failed');
      const legs = data as Record<Holding, ReturnLeg>;
      return Response.json(
        {
          mode,
          symbol,
          source,
          legs: Object.fromEntries(
            Object.entries(legs).map(([h, l]) => [
              h,
              {
                ...l,
                returnPct: l.reason ? null : priceReturn(l.entry, l.exit),
              },
            ]),
          ),
          notice:
            'Kiểm tra giá báo cáo chưa xác minh adjusted/unadjusted và lịch phiên; không phải backtest Top 10, không dùng để kết luận chiến lược có lợi nhuận.',
        },
        { headers },
      );
    }
    const { data, error } = await db.rpc('backtest_history', {
      period: horizon,
      before_time: before,
      before_id: id,
      take: 10,
    });
    if (error || !Array.isArray(data) || data.length > 10)
      throw Error('Read failed');
    const cohorts = (data as Cohort[]).map(evaluateCohort),
      last = cohorts.at(-1);
    return Response.json(
      {
        mode,
        horizon,
        asOf: new Date().toISOString(),
        data: cohorts,
        next:
          cohorts.length === 10 && last
            ? { before: last.recorded_at, id: last.id }
            : null,
        methodology: 'observed-next-open-v1',
        notice: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      {
        error:
          'Không đọc được backtest; không đủ dữ liệu hoặc migration chưa sẵn sàng.',
      },
      { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } },
    );
  }
}
