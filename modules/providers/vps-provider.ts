import type { CurrentQuote, DataProvider } from './data-provider';
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
interface Options {
  ttlMs: number;
  minIntervalMs: number;
  retries: number;
  retryDelayMs: number;
  timeoutMs: number;
}
export class VpsProvider implements DataProvider {
  private cache = new Map<string, { expires: number; data: CurrentQuote[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly options: Options = {
      ttlMs: 15_000,
      minIntervalMs: 1000,
      retries: 2,
      retryDelayMs: 500,
      timeoutMs: 10_000,
    },
  ) {
    if (
      !Object.values(options).every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isInteger(options.retries) ||
      options.retries > 5 ||
      options.timeoutMs <= 0
    )
      throw new Error('Cấu hình retry/cache không hợp lệ');
  }
  fetchQuotes(symbols: readonly string[]): Promise<CurrentQuote[]> {
    let wanted: string[];
    try {
      wanted = validatedSymbols(symbols);
    } catch (error) {
      return Promise.reject(error);
    }
    const result = this.queue.then(() => this.load(wanted));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async load(symbols: string[]): Promise<CurrentQuote[]> {
    const key = symbols.join(',');
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now())
      return structuredClone(cached.data);
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      const wait = Math.max(
        0,
        this.options.minIntervalMs - (Date.now() - this.lastRequest),
      );
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequest = Date.now();
      let response: Response;
      try {
        response = await this.transport(VPS_ENDPOINT + key, {
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: 'error',
        });
      } catch {
        if (attempt === this.options.retries)
          throw new Error('Không kết nối được VPS');
        await this.backoff(attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === this.options.retries)
          throw new Error(`VPS HTTP ${response.status}`);
        const header = response.headers.get('Retry-After');
        const seconds = header !== null ? Number(header) : NaN;
        const retryMs = Number.isFinite(seconds)
          ? seconds * 1000
          : header
            ? Date.parse(header) - Date.now()
            : 0;
        if (retryMs > 30_000) throw new Error('VPS yêu cầu retry ở job sau');
        await this.backoff(attempt, Math.max(0, retryMs || 0));
        continue;
      }
      if (!response.ok) throw new Error(`VPS HTTP ${response.status}`);
      const data = parseVpsPayload(
        await response.json(),
        new Date().toISOString(),
      );
      if (
        data.length !== symbols.length ||
        data.some((q) => !symbols.includes(q.symbol))
      )
        throw new Error('VPS thiếu mã yêu cầu hoặc trả mã ngoài danh sách');
      for (const [cacheKey, entry] of this.cache)
        if (entry.expires <= Date.now()) this.cache.delete(cacheKey);
      if (this.cache.size >= 30)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + this.options.ttlMs, data });
      return structuredClone(data);
    }
    throw new Error('Không có dữ liệu VPS');
  }
  private async backoff(attempt: number, retryMs = 0) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(retryMs, this.options.retryDelayMs * 2 ** attempt),
      ),
    );
  }
}
