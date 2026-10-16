import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import type {
  CurrentQuote,
  DailyBar,
} from '../../../modules/providers/data-provider';
import { VpsProvider } from '../../../modules/providers/vps-provider';
import { KbsProvider } from '../../../modules/providers/kbs-provider';
import { liveQuotes, persistQuotes } from '../live-quotes';
import { defaultHttpOptions } from '../../../modules/providers/http';
import { displayPrice } from '../../../modules/market/display-price';
import { vietnamDate, yearsBefore } from '../../../modules/market/calendar';
type Stock = {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  source: string;
};
const refreshes = new Map<string, number>();
let historyTransport: typeof fetch | null = null;
let vpsHistory: VpsProvider;
let kbsHistory: KbsProvider;
function historyProvider(source: string) {
  if (historyTransport !== fetch) {
    historyTransport = fetch;
    const options = { ...defaultHttpOptions, retries: 0, timeoutMs: 8000 };
    vpsHistory = new VpsProvider(fetch, options);
    kbsHistory = new KbsProvider(fetch, options);
  }
  return source === 'KBS' ? kbsHistory : vpsHistory;
}
export async function stockSnapshot(
  db: SupabaseClient,
  stock: Stock,
  env: Env,
  view: 'summary' | 'history',
  fresh: boolean,
  context?: Pick<ExecutionContext, 'waitUntil'>,
) {
  const today = vietnamDate(Date.now());
  const source = env.HISTORY_PROVIDER === 'kbs' ? 'KBS' : 'VPS';
  const [qResult, hResult, cResult] = await Promise.all([
    db
      .from('prices_current')
      .select('*')
      .eq('stock_id', stock.id)
      .maybeSingle(),
    view === 'history'
      ? db
          .from('prices_history')
          .select('*')
          .eq('stock_id', stock.id)
          .eq('source', source)
          .gte('session_date', yearsBefore(today, 3))
          .lte('session_date', today)
          .order('session_date')
          .limit(1000)
      : db
          .from('prices_history')
          .select('*')
          .eq('stock_id', stock.id)
          .eq('source', source)
          .lt('session_date', today)
          .order('session_date', { ascending: false })
          .limit(1),
    db
      .from('stock_closing_snapshots')
      .select('*')
      .eq('stock_id', stock.id)
      .eq('source', source)
      .lt('session_date', today)
      .maybeSingle(),
  ]);
  if (qResult.error || hResult.error || cResult.error)
    throw new Error('Snapshot unavailable');
  const row = qResult.data;
  let quote: CurrentQuote | null = row
    ? {
        symbol: stock.symbol,
        referenceVnd: Number(row.reference_vnd),
        ceilingVnd: Number(row.ceiling_vnd),
        floorVnd: Number(row.floor_vnd),
        lastPriceVnd:
          row.last_price_vnd === null ? null : Number(row.last_price_vnd),
        bid3PriceVnd:
          row.bid3_price_vnd === null ? null : Number(row.bid3_price_vnd),
        totalVolumeShares: Number(row.total_volume_shares),
        volumeRaw: {
          lastVolume: Number(row.last_volume_raw),
          lot: Number(row.lot_raw),
          lastVolumeUnit: 'unverified',
          lotUnit: 'lot_of_10_shares',
        },
        volumeVerificationScope: 'ACB_2026-10-12_only',
        marketCodeRaw: null,
        fetchedAt: row.fetched_at,
        exchangeTimestamp: null,
        priceBasis: 'unverified',
        semantics: {
          lastPrice: 'inferred_from_field_name',
          bid3: 'inferred_from_acb_contract',
        },
      }
    : null;
  let bars: DailyBar[] = (hResult.data ?? []).map((r) => ({
    symbol: stock.symbol,
    sessionDate: r.session_date,
    openVnd: Number(r.open_vnd),
    highVnd: Number(r.high_vnd),
    lowVnd: Number(r.low_vnd),
    closeVnd: Number(r.close_vnd),
    volumeReported: Number(r.volume_reported),
    volumeUnit: 'shares',
    source,
    priceBasis: 'unverified',
    fetchedAt: r.fetched_at,
    isFinal: false,
    finality: 'unverified',
  }));
  const writer = env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  const updateQuote = async () => {
    const q = (await liveQuotes([stock.symbol]))[0]!;
    if (writer) await persistQuotes(writer, [q]);
    return q;
  };
  const updateHistory = async () => {
    const result = await historyProvider(source).fetchHistory(
      stock.symbol,
      yearsBefore(today, 3),
      today,
    );
    if (writer && result.length) {
      const { error } = await writer.rpc('ingest_price_history', {
        rows: result.map((b) => ({
          stock_id: stock.id,
          session_date: b.sessionDate,
          source: b.source,
          open_vnd: b.openVnd,
          high_vnd: b.highVnd,
          low_vnd: b.lowVnd,
          close_vnd: b.closeVnd,
          volume_reported: b.volumeReported,
          is_final: false,
          fetched_at: b.fetchedAt,
        })),
      });
      if (error) throw new Error('History persistence unavailable');
    }
    return result;
  };
  const previousBar = [...bars].reverse().find((b) => b.sessionDate < today);
  let close = previousBar
    ? {
        sessionDate: previousBar.sessionDate,
        closeVnd: previousBar.closeVnd,
        source,
        fetchedAt: previousBar.fetchedAt,
      }
    : null;
  if (
    cResult.data &&
    (!close ||
      cResult.data.session_date > close.sessionDate ||
      (cResult.data.session_date === close.sessionDate &&
        Date.parse(cResult.data.fetched_at) >= Date.parse(close.fetchedAt)))
  )
    close = {
      sessionDate: cResult.data.session_date,
      closeVnd: Number(cResult.data.price_vnd),
      source,
      fetchedAt: cResult.data.fetched_at,
    };
  const updateClose = async () => {
    const recent = await historyProvider(source).fetchHistory(
      stock.symbol,
      vietnamDate(Date.now() - 14 * 86400000),
      today,
    );
    const last = recent.filter((b) => b.sessionDate < today).at(-1);
    if (!last) return null;
    if (writer) {
      const { error } = await writer.rpc('cache_reported_close', {
        sid: stock.id,
        provider: source,
        day: last.sessionDate,
        price: last.closeVnd,
        stamp: last.fetchedAt,
      });
      if (error) throw new Error('Closing snapshot persistence unavailable');
    }
    return {
      sessionDate: last.sessionDate,
      closeVnd: last.closeVnd,
      source,
      fetchedAt: last.fetchedAt,
    };
  };
  const background = (
    key: string,
    ttl: number,
    load: () => Promise<unknown>,
  ) => {
    if (!context || !writer || (refreshes.get(key) ?? 0) > Date.now()) return;
    for (const [k, expires] of refreshes)
      if (expires <= Date.now()) refreshes.delete(k);
    if (refreshes.size >= 100) return;
    refreshes.set(key, Date.now() + ttl);
    context.waitUntil(
      load().catch(() =>
        console.warn(
          'Background market refresh unavailable; preserved snapshot',
        ),
      ),
    );
  };
  const notices: string[] = [];
  if (view === 'summary') {
    if (fresh || (!quote && !close)) {
      try {
        quote = await updateQuote();
      } catch {
        notices.push('Nguồn quote tạm chậm; đang dùng giá đã lưu.');
      }
    } else if (!quote || Date.now() - Date.parse(quote.fetchedAt) > 5000)
      background('q:' + stock.symbol, 5000, updateQuote);
    if (!close && quote?.lastPriceVnd == null) {
      try {
        close = await updateClose();
      } catch {
        notices.push(
          'Chưa nhận được giá đóng cửa từ nguồn. Không dùng giá tham chiếu thay thế.',
        );
      }
    } else if (!close || vietnamDate(Date.parse(close.fetchedAt)) < today)
      background('c:' + source + stock.symbol, 900000, updateClose);
  } else if (!bars.length) {
    try {
      bars = await updateHistory();
    } catch {
      notices.push('Không tải được biểu đồ. Bạn có thể thử lại.');
    }
  } else if (Date.now() - Date.parse(bars.at(-1)!.fetchedAt) > 900000)
    background('h:' + source + stock.symbol, 900000, updateHistory);
  if (
    view === 'summary' &&
    quote &&
    Date.now() - Date.parse(quote.fetchedAt) > 60000
  )
    notices.push(
      'Chưa nhận được snapshot giá mới trong hơn 1 phút; xem thời điểm nhận, không coi giá lưu là giá trực tiếp.',
    );
  return Response.json(
    {
      stock,
      quote,
      bars: view === 'history' ? bars : [],
      displayPrice: displayPrice(
        quote,
        close
          ? { sessionDate: close.sessionDate, closeVnd: close.closeVnd, source }
          : null,
      ),
      historySource: source,
      notices,
      notice:
        'Giá theo VND. Giá đóng cửa dự phòng có ngày và nguồn riêng; chưa xác minh điều chỉnh giá và timestamp sàn.',
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': view === 'summary' ? 'no-store' : 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
