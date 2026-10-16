import deployment from '../../config/public-deployment.json';
import type { DisplayPrice } from '../../modules/market/display-price';
import { record } from '../../modules/providers/market-schema';
import { validSourceDate } from '../../modules/providers/source-evidence';
import type {
  DailyBar,
  CurrentQuote,
  Exchange,
} from '../../modules/providers/data-provider';
export interface MarketStock {
  coverage?: number;
  graham_coverage?: number;
  buffett_coverage?: number;
  annual_years?: number;
  latest_year?: number | null;
  symbol: string;
  name: string;
  exchange: Exchange;
  source: string;
}
export interface StockDetail {
  stock: MarketStock;
  quote: CurrentQuote | null;
  bars: DailyBar[];
  notices: string[];
  historySource: string;
  notice: string;
  displayPrice?: DisplayPrice;
}
const detailCache = new Map<string, { at: number; data: StockDetail }>();
export function cachedStockDetail(
  symbol: string,
  view = 'summary',
): StockDetail | null {
  return detailCache.get(symbol + ':' + view)?.data ?? null;
}
function stock(value: unknown): value is MarketStock {
  return (
    record(value) &&
    typeof value.symbol === 'string' &&
    /^[A-Z0-9]{3,12}$/.test(value.symbol) &&
    typeof value.name === 'string' &&
    ['HOSE', 'HNX', 'UPCOM'].includes(String(value.exchange)) &&
    typeof value.source === 'string' &&
    ['coverage', 'graham_coverage', 'buffett_coverage'].every(
      (k) =>
        value[k] === undefined ||
        (typeof value[k] === 'number' &&
          Number.isFinite(value[k]) &&
          value[k] >= 0 &&
          value[k] <= 1),
    ) &&
    (value.annual_years === undefined ||
      (typeof value.annual_years === 'number' &&
        Number.isInteger(value.annual_years) &&
        value.annual_years >= 0)) &&
    (value.latest_year === undefined ||
      value.latest_year === null ||
      (typeof value.latest_year === 'number' &&
        Number.isInteger(value.latest_year)))
  );
}
export async function marketJson(
  path: string,
  signal: AbortSignal,
  cache?: RequestCache,
): Promise<unknown> {
  const base =
    process.env.NEXT_PUBLIC_WORKER_URL ||
    (typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? window.location.origin
      : deployment.workerUrl);
  const response = await fetch(new URL(path, base), {
    signal,
    ...(cache ? { cache } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'Không tìm thấy mã chứng khoán.'
        : `Nguồn dữ liệu chưa sẵn sàng (HTTP ${response.status}).`,
    );
  return response.json();
}
export async function searchStocks(
  query: string,
  exchange: string,
  signal: AbortSignal,
): Promise<MarketStock[]> {
  const params = new URLSearchParams({ q: query });
  if (exchange) params.set('exchange', exchange);
  const body = await marketJson('/v1/stocks?' + params, signal);
  if (!record(body) || !Array.isArray(body.data) || !body.data.every(stock))
    throw new Error('Danh mục trả về không hợp lệ.');
  return body.data;
}
export async function stockDetail(
  symbol: string,
  signal: AbortSignal,
  view: 'full' | 'summary' | 'history' = 'full',
  fresh = false,
): Promise<StockDetail> {
  const key = symbol + ':' + view;
  const cached = detailCache.get(key);
  if (
    !fresh &&
    cached &&
    Date.now() - cached.at < (view === 'history' ? 60000 : 0)
  )
    return cached.data;
  const body = await marketJson(
    '/v1/stocks/' +
      encodeURIComponent(symbol) +
      (view === 'full' ? '' : '?view=' + view + (fresh ? '&refresh=1' : '')),
    signal,
    view === 'summary' || fresh ? 'no-store' : undefined,
  );
  if (
    !record(body) ||
    !stock(body.stock) ||
    body.stock.symbol !== symbol ||
    !Array.isArray(body.bars) ||
    !Array.isArray(body.notices) ||
    !body.notices.every((n) => typeof n === 'string') ||
    typeof body.notice !== 'string' ||
    typeof body.historySource !== 'string'
  )
    throw new Error('Dữ liệu mã không hợp lệ.');
  let previous = '';
  for (const row of body.bars) {
    if (
      !record(row) ||
      row.symbol !== symbol ||
      typeof row.sessionDate !== 'string' ||
      !validSourceDate(row.sessionDate) ||
      row.sessionDate <= previous ||
      !['openVnd', 'highVnd', 'lowVnd', 'closeVnd'].every(
        (k) =>
          typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] > 0,
      ) ||
      typeof row.volumeReported !== 'number' ||
      !Number.isSafeInteger(row.volumeReported) ||
      row.volumeReported < 0 ||
      row.source !== body.historySource ||
      row.priceBasis !== 'unverified' ||
      typeof row.fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.fetchedAt)) ||
      row.volumeUnit !== 'shares' ||
      typeof row.isFinal !== 'boolean'
    )
      throw new Error('Lịch sử giá thiếu hoặc sai dữ liệu.');
    const values = row as unknown as DailyBar;
    if (
      values.highVnd <
        Math.max(values.openVnd, values.closeVnd, values.lowVnd) ||
      values.lowVnd > Math.min(values.openVnd, values.closeVnd)
    )
      throw new Error('OHLC trả về không hợp lệ.');
    previous = row.sessionDate;
  }
  if (body.quote !== null) {
    const q = body.quote;
    if (
      !record(q) ||
      q.symbol !== symbol ||
      !['referenceVnd', 'ceilingVnd', 'floorVnd'].every(
        (k) => typeof q[k] === 'number' && Number.isFinite(q[k]) && q[k] > 0,
      ) ||
      (q.lastPriceVnd !== null &&
        (typeof q.lastPriceVnd !== 'number' ||
          !Number.isFinite(q.lastPriceVnd) ||
          q.lastPriceVnd <= 0)) ||
      typeof q.totalVolumeShares !== 'number' ||
      !Number.isSafeInteger(q.totalVolumeShares) ||
      q.totalVolumeShares < 0 ||
      typeof q.fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(q.fetchedAt))
    )
      throw new Error('Giá hiện tại không hợp lệ.');
  }
  if (
    body.displayPrice !== undefined &&
    (!record(body.displayPrice) ||
      !['quote', 'close', 'unavailable'].includes(
        String(body.displayPrice.kind),
      ) ||
      (body.displayPrice.valueVnd !== null &&
        (typeof body.displayPrice.valueVnd !== 'number' ||
          !Number.isFinite(body.displayPrice.valueVnd) ||
          body.displayPrice.valueVnd <= 0)) ||
      (body.displayPrice.kind === 'close' &&
        (typeof body.displayPrice.sessionDate !== 'string' ||
          !validSourceDate(body.displayPrice.sessionDate))) ||
      typeof body.displayPrice.source !== 'string')
  )
    throw new Error('Giá hiển thị không hợp lệ.');
  const result = body as unknown as StockDetail;
  if (detailCache.size >= 40)
    detailCache.delete(detailCache.keys().next().value!);
  detailCache.set(key, { at: Date.now(), data: result });
  return result;
}
