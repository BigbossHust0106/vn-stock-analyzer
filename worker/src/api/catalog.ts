import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { normalizeSearch } from '../../../modules/market/search';
import { scoreStock } from '../../../modules/scoring/engine';
import { isFinancialData } from '../../../modules/providers/financial-types';
type Counts = {
  catalog: number;
  withAnnual: number;
  withoutSnapshot: number;
  otherSnapshots: number;
  asOf: string;
};
let countsTransport: typeof fetch;
const countsCache = new Map<
  string,
  { until: number; value: Promise<Counts> }
>();
async function marketCounts(db: SupabaseClient, key: string): Promise<Counts> {
  if (countsTransport !== fetch) {
    countsTransport = fetch;
    countsCache.clear();
  }
  const old = countsCache.get(key);
  if (old && old.until > Date.now()) return old.value;
  if (countsCache.size >= 32)
    countsCache.delete(countsCache.keys().next().value!);
  const value = (async () => {
    const [total, stored, annual] = await Promise.all([
      db
        .from('stocks')
        .select('id', { count: 'exact', head: true })
        .eq('active', true),
      db
        .from('financial_snapshots')
        .select('stock_id,stocks!inner(active)', { count: 'exact', head: true })
        .eq('stocks.active', true),
      db
        .from('financial_snapshots')
        .select('stock_id,stocks!inner(active)', { count: 'exact', head: true })
        .eq('stocks.active', true)
        .not('payload->annual', 'eq', '[]'),
    ]);
    if ([total, stored, annual].some((r) => r.error || r.count === null))
      throw Error('Counts unavailable');
    return {
      catalog: total.count!,
      withAnnual: annual.count!,
      withoutSnapshot: total.count! - stored.count!,
      otherSnapshots: stored.count! - annual.count!,
      asOf: new Date().toISOString(),
    };
  })();
  countsCache.set(key, { until: Date.now() + 300000, value });
  try {
    return await value;
  } catch (e) {
    countsCache.delete(key);
    throw e;
  }
}
export async function catalogResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/catalog') return null;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=120',
    'X-Content-Type-Options': 'nosniff',
  };
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const q = url.searchParams.get('q') ?? '';
  const exchange = url.searchParams.get('exchange');
  const filter = url.searchParams.get('financials') ?? 'all';
  const pageText = url.searchParams.get('page') ?? '1';
  const page = Number(pageText);
  if (
    q.length > 80 ||
    (exchange !== null && !['HOSE', 'HNX', 'UPCOM'].includes(exchange)) ||
    !['all', 'available', 'missing'].includes(filter) ||
    !/^[1-9]\d{0,4}$/.test(pageText)
  )
    return reply({ error: 'Bộ lọc danh mục không hợp lệ' }, 400);
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: 'Chưa cấu hình dữ liệu' }, 503);
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const pageSize = 24;
    const embed =
      filter === 'available'
        ? 'financial_snapshots!inner(payload,fetched_at)'
        : 'financial_snapshots(payload,fetched_at)';
    let query = db
      .from('stocks')
      .select(
        'symbol,name,exchange,source,' +
          embed +
          ',prices_current(last_price_vnd,fetched_at)',
        { count: 'exact' },
      )
      .eq('active', true)
      .order('symbol')
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (exchange) query = query.eq('exchange', exchange);
    if (q)
      query = query.like(
        'search_text',
        '%' +
          normalizeSearch(q)
            .replaceAll('\\', '\\\\')
            .replaceAll('%', '\\%')
            .replaceAll('_', '\\_') +
          '%',
      );
    if (filter === 'available')
      query = query.not('financial_snapshots.payload->annual', 'eq', '[]');
    if (filter === 'missing') query = query.is('financial_snapshots', null);
    const [result, counts] = await Promise.all([
      query,
      marketCounts(
        db,
        (env.SUPABASE_URL || deployment.supabaseUrl) +
          '\n' +
          env.SUPABASE_PUBLISHABLE_KEY,
      ),
    ]);
    if (result.error || result.count === null)
      throw Error('Catalog read failed');
    const stamp = new Date().toISOString();
    const rows = (result.data ?? []).map((value) => {
      // Supabase infers dynamic select strings as unknown. Validate domain data
      // before evaluating coverage; never treat malformed financials as facts.
      const r = value as unknown as {
        symbol: string;
        name: string;
        exchange: string;
        source: string;
        financial_snapshots: { payload: unknown; fetched_at: string } | null;
        prices_current: {
          last_price_vnd: number | null;
          fetched_at: string;
        } | null;
      };
      const f = r.financial_snapshots?.payload;
      const financials = isFinancialData(f) && f.symbol === r.symbol ? f : null;
      const report = scoreStock(
        financials,
        r.prices_current?.last_price_vnd ?? null,
        stamp,
        undefined,
        r.prices_current?.fetched_at ?? null,
      );
      return {
        symbol: r.symbol,
        name: r.name,
        exchange: r.exchange,
        source: r.source,
        financial_state: !r.financial_snapshots
          ? 'missing'
          : !financials
            ? 'invalid'
            : !financials.supported
              ? 'unsupported'
              : financials.annual.length
                ? 'available'
                : 'empty',
        financial_fetched_at: r.financial_snapshots?.fetched_at ?? null,
        coverage: report.coverage,
        graham_coverage: report.strategies[0]!.coverage,
        buffett_coverage: report.strategies[1]!.coverage,
        annual_years: financials?.annual.length ?? 0,
        latest_year: financials?.annual.at(-1)?.year ?? null,
      };
    });
    return reply({
      data: rows,
      total: result.count,
      page,
      pageSize,
      asOf: stamp,
      counts: {
        catalog: counts.catalog,
        withAnnual: counts.withAnnual,
        withoutSnapshot: counts.withoutSnapshot,
        otherSnapshots: counts.otherSnapshots,
      },
      countsAsOf: counts.asOf,
      order: 'symbol_ascending',
      notice:
        'Độ phủ dữ liệu không phải chất lượng doanh nghiệp hay khuyến nghị mua. Số đếm toàn danh mục nguồn, bộ lọc áp dụng cho danh sách.',
    });
  } catch {
    return reply(
      { error: 'Không đọc được danh mục đầy đủ; không hiển thị số ước lượng.' },
      502,
    );
  }
}
