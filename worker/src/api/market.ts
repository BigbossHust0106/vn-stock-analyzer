import { createClient } from '@supabase/supabase-js';
import { stockSnapshot } from './stock-snapshot';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { providers } from '../../../modules/providers/registry';
import { normalizeSearch } from '../../../modules/market/search';
import { vietnamDate, yearsBefore } from '../../../modules/market/calendar';
import type {
  DailyBar,
  CurrentQuote,
} from '../../../modules/providers/data-provider';
import { symbolValue } from '../../../modules/providers/market-schema';

const instances = new Map<string, ReturnType<typeof providers>>();
export function marketProviders(env: Env) {
  const key = JSON.stringify([
    env.FUNDAMENTALS_PROVIDER,
    env.CATALOG_PROVIDER,
    env.HISTORY_PROVIDER,
    env.QUOTE_PROVIDER,
  ]);
  let found = instances.get(key);
  if (!found) {
    found = providers(env);
    instances.set(key, found);
  }
  return found;
}
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=15',
  'X-Content-Type-Options': 'nosniff',
};
export async function marketResponse(
  request: Request,
  env: Env,
  context?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/stocks' && !url.pathname.startsWith('/v1/stocks/'))
    return null;
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json(
      { error: 'Nguồn dữ liệu chưa được cấu hình' },
      { status: 503, headers },
    );
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    if (url.pathname === '/v1/stocks') {
      const query = url.searchParams.get('q') ?? '';
      const exchange = url.searchParams.get('exchange');
      if (
        query.length > 80 ||
        (exchange !== null && !['HOSE', 'HNX', 'UPCOM'].includes(exchange))
      )
        return Response.json(
          { error: 'Truy vấn không hợp lệ' },
          { status: 400, headers },
        );
      const { data, error } = await db.rpc('search_stocks_by_coverage', {
        q: normalizeSearch(query),
        market: exchange,
      });
      if (error) throw new Error('Search unavailable');
      return Response.json({ data }, { headers });
    }
    const symbol = url.pathname.slice('/v1/stocks/'.length);
    try {
      symbolValue(symbol);
    } catch {
      return Response.json(
        { error: 'Mã không hợp lệ' },
        { status: 400, headers },
      );
    }
    const { data: stock, error } = await db
      .from('stocks')
      .select('id,symbol,name,exchange,source')
      .eq('symbol', symbol)
      .eq('active', true)
      .maybeSingle();
    if (error) throw new Error('Read unavailable');
    if (!stock)
      return Response.json(
        { error: 'Không tìm thấy cổ phiếu trên HOSE/HNX/UPCOM' },
        { status: 404, headers },
      );
    const view = url.searchParams.get('view');
    if (view === 'summary' || view === 'history')
      return await stockSnapshot(
        db,
        stock,
        { ...env, SUPABASE_URL: env.SUPABASE_URL || deployment.supabaseUrl },
        view,
        url.searchParams.get('refresh') === '1',
        context,
      );
    if (view !== null && view !== 'full')
      return Response.json(
        { error: 'Chế độ dữ liệu không hợp lệ' },
        { status: 400, headers },
      );
    const source = marketProviders(env);
    const today = vietnamDate(Date.now());
    const from = yearsBefore(today, 3);
    const historySource = env.HISTORY_PROVIDER === 'kbs' ? 'KBS' : 'VPS';
    const { data: stored, error: historyError } = await db
      .from('prices_history')
      .select('*')
      .eq('stock_id', stock.id)
      .eq('source', historySource)
      .gte('session_date', from)
      .lte('session_date', today)
      .order('session_date')
      .limit(1000);
    if (historyError) throw new Error('History unavailable');
    let bars: DailyBar[] = (stored ?? []).map((r) => ({
      symbol,
      sessionDate: r.session_date,
      openVnd: Number(r.open_vnd),
      highVnd: Number(r.high_vnd),
      lowVnd: Number(r.low_vnd),
      closeVnd: Number(r.close_vnd),
      volumeReported: Number(r.volume_reported),
      volumeUnit: 'shares',
      source: historySource,
      priceBasis: 'unverified',
      fetchedAt: r.fetched_at,
      isFinal: false,
      finality: 'unverified',
    }));
    const notices: string[] = [];
    if (
      bars.length < 200 ||
      Date.now() - Date.parse(bars.at(-1)!.fetchedAt) > 900000
    ) {
      try {
        const fresh = await source.history.fetchHistory(symbol, from, today);
        if (fresh.length) {
          bars = fresh;
          persistHistory(env, stock.id, bars, context);
        }
      } catch {
        notices.push(
          bars.length
            ? 'Nguồn lịch sử đang lỗi; đang dùng dữ liệu đã lưu.'
            : 'Chưa lấy được lịch sử giá.',
        );
      }
    }
    let quote: CurrentQuote | null = null;
    try {
      quote = (await source.quotes.fetchQuotes([symbol]))[0] ?? null;
      if (quote && env.SUPABASE_SERVICE_ROLE_KEY && context) {
        const writer = createClient(
          env.SUPABASE_URL || deployment.supabaseUrl,
          env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const q = quote;
        context.waitUntil(
          Promise.resolve(
            writer.rpc('ingest_current_quotes', {
              rows: [
                {
                  symbol,
                  reference_vnd: q.referenceVnd,
                  ceiling_vnd: q.ceilingVnd,
                  floor_vnd: q.floorVnd,
                  last_price_vnd: q.lastPriceVnd,
                  bid3_price_vnd: q.bid3PriceVnd,
                  last_volume_raw: q.volumeRaw.lastVolume,
                  lot_raw: q.volumeRaw.lot,
                  fetched_at: q.fetchedAt,
                },
              ],
            }),
          ).then(({ error }) => {
            if (error) console.error('Không lưu được snapshot thị trường');
          }),
        );
      }
    } catch {
      const { data: cached } = await db
        .from('prices_current')
        .select('*')
        .eq('stock_id', stock.id)
        .maybeSingle();
      if (cached)
        quote = {
          symbol,
          referenceVnd: Number(cached.reference_vnd),
          ceilingVnd: Number(cached.ceiling_vnd),
          floorVnd: Number(cached.floor_vnd),
          lastPriceVnd:
            cached.last_price_vnd === null
              ? null
              : Number(cached.last_price_vnd),
          bid3PriceVnd:
            cached.bid3_price_vnd === null
              ? null
              : Number(cached.bid3_price_vnd),
          totalVolumeShares: Number(cached.total_volume_shares),
          volumeRaw: {
            lastVolume: Number(cached.last_volume_raw),
            lot: Number(cached.lot_raw),
            lastVolumeUnit: 'unverified',
            lotUnit: 'lot_of_10_shares',
          },
          volumeVerificationScope: 'ACB_2026-10-12_only',
          marketCodeRaw: null,
          fetchedAt: cached.fetched_at,
          exchangeTimestamp: null,
          priceBasis: 'unverified',
          semantics: {
            lastPrice: 'inferred_from_field_name',
            bid3: 'inferred_from_acb_contract',
          },
        };
      notices.push(
        quote
          ? 'VPS đang lỗi; đang hiển thị snapshot đã lưu, xem thời điểm nhận dữ liệu.'
          : 'Không lấy được quote từ VPS; không dùng giá đóng cửa thay thế.',
      );
    }
    let profile = stock;
    try {
      profile = { ...stock, ...(await source.profile.fetchProfile(symbol)) };
    } catch {
      notices.push('Thông tin công ty lấy từ danh mục KBS đã đồng bộ.');
    }
    return Response.json(
      {
        stock: profile,
        quote,
        bars,
        notices,
        historySource,
        notice:
          'Giá hiển thị theo VND, khối lượng theo cổ phiếu (đối soát mẫu). Chưa xác minh cách điều chỉnh cổ tức/chia tách. Giá phiên hiện tại có thể thay đổi.',
        disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      {
        error: 'Không đọc được dữ liệu thị trường; kiểm tra migration/provider',
      },
      { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } },
    );
  }
}
function persistHistory(
  env: Env,
  stockId: string,
  bars: DailyBar[],
  context?: Pick<ExecutionContext, 'waitUntil'>,
) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !context) return;
  const writer = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  context.waitUntil(
    Promise.resolve(
      writer.rpc('ingest_price_history', {
        rows: bars.map((b) => ({
          stock_id: stockId,
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
      }),
    ).then(({ error }) => {
      if (error) console.error('Không lưu được history thị trường');
    }),
  );
}
