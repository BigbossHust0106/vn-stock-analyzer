import type {
  CurrentQuote,
  DataProvider,
  Exchange,
  StockInfo,
  DailyBar,
} from './data-provider';
import { ProviderHttp, defaultHttpOptions, type HttpOptions } from './http';
import {
  parseVpsHistory,
  parseVpsProfile,
  historyRange,
  symbolValue,
} from './market-schema';
import { VPS_LOT_SIZE, VPS_VOLUME_VERIFICATION_SCOPE } from './vps-config';
import {
  parseBookLevel,
  validateVpsResponse,
  VpsValidationError,
} from './vps-schema';

// Endpoint do người dùng xác nhận; không chính thức, có thể bị đổi hoặc chặn.
export const VPS_ENDPOINT =
  'https://bgapidatafeed.vps.com.vn/getliststockdata/';
export function parseVpsPayload(
  payload: unknown,
  fetchedAt: string,
): CurrentQuote[] {
  if (!Number.isFinite(Date.parse(fetchedAt)))
    throw new VpsValidationError('fetchedAt', 'timestamp không hợp lệ');
  return validateVpsResponse(payload).map((row) => ({
    symbol: row.sym,
    referenceVnd: row.r * 1000,
    ceilingVnd: row.c * 1000,
    floorVnd: row.f * 1000,
    // Mapping lastPrice đã đối chiếu trên ACB 12/10/2026, không chứng nhận mọi mã/phiên.
    lastPriceVnd: row.lastPrice === 0 ? null : row.lastPrice * 1000,
    bid3PriceVnd: parseBookLevel(row.g3, `${row.sym}.g3`).priceVnd,
    volumeRaw: {
      lastVolume: row.lastVolume,
      lot: row.lot,
      lastVolumeUnit: 'unverified',
      lotUnit: 'lot_of_10_shares',
    },
    totalVolumeShares: row.lot * VPS_LOT_SIZE,
    volumeVerificationScope: VPS_VOLUME_VERIFICATION_SCOPE,
    marketCodeRaw: row.mc,
    fetchedAt,
    exchangeTimestamp: null,
    priceBasis: 'unverified',
    semantics: {
      lastPrice:
        row.sym === 'ACB'
          ? 'verified_on_acb_one_day'
          : 'inferred_from_field_name',
      bid3:
        row.sym === 'ACB'
          ? 'user_verified_for_acb'
          : 'inferred_from_acb_contract',
    },
  }));
}
export function validatedSymbols(symbols: readonly string[]): string[] {
  if (
    !symbols.length ||
    symbols.length > 50 ||
    !symbols.every((s) => /^[A-Z0-9]{3,12}$/.test(s))
  )
    throw new Error('Cần 1–50 mã chứng khoán hợp lệ');
  return [...new Set(symbols)].sort();
}
export class VpsProvider implements DataProvider {
  private http: ProviderHttp;
  constructor(
    transport: typeof fetch = fetch,
    options: HttpOptions = defaultHttpOptions,
  ) {
    this.http = new ProviderHttp('VPS', transport, options);
  }
  fetchQuotes(symbols: readonly string[]): Promise<CurrentQuote[]> {
    let wanted: string[];
    try {
      wanted = validatedSymbols(symbols);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = wanted.join(',');
    return this.http.cached('quotes:' + key, this.http.quoteTtl, async () => {
      const data = parseVpsPayload(
        await this.http.request(VPS_ENDPOINT + key),
        new Date().toISOString(),
      );
      if (
        data.length !== wanted.length ||
        data.some((q) => !wanted.includes(q.symbol))
      )
        throw new Error('VPS thiếu mã yêu cầu hoặc trả mã ngoài danh sách');
      return data;
    });
  }
  async fetchStocks(_exchange?: Exchange): Promise<StockInfo[]> {
    void _exchange;
    throw new Error(
      'Danh mục VPS chưa có contract khả dụng; cấu hình CATALOG_PROVIDER=kbs',
    );
  }
  fetchProfile(symbol: string): Promise<StockInfo> {
    symbolValue(symbol);
    return this.http.cached('profile:' + symbol, 86400000, async () =>
      parseVpsProfile(
        await this.http.request(
          'https://histdatafeed.vps.com.vn/tradingview/symbols?symbol=' +
            symbol,
        ),
        symbol,
        new Date().toISOString(),
      ),
    );
  }
  fetchHistory(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    symbolValue(symbol);
    historyRange(from, to);
    const url = new URL('https://histdatafeed.vps.com.vn/tradingview/history');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('resolution', 'D');
    url.searchParams.set(
      'from',
      String(Math.floor(Date.parse(from + 'T00:00:00+07:00') / 1000)),
    );
    url.searchParams.set(
      'to',
      String(
        Math.floor(
          (Date.parse(to + 'T00:00:00+07:00') + 86400000 - 1000) / 1000,
        ),
      ),
    );
    return this.http.cached('history:' + url.href, 900000, async () => {
      const bars = parseVpsHistory(
        await this.http.request(url.href),
        symbol,
        new Date().toISOString(),
      );
      return bars.filter((b) => b.sessionDate >= from && b.sessionDate <= to);
    });
  }
}
