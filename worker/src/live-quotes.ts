import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurrentQuote } from '../../modules/providers/data-provider';
import {
  VpsProvider,
  validatedSymbols,
} from '../../modules/providers/vps-provider';
import { defaultHttpOptions } from '../../modules/providers/http';

// Shared within an isolate: coalesce identical batches, short cache and failure cooldown.
// This samples a source response, never certifies an exchange session/timestamp.
let transport: typeof fetch;
let provider: VpsProvider;
let pending = new Map<string, Promise<CurrentQuote[]>>();
let failures = new Map<string, number>();
export function liveQuotes(
  symbols: readonly string[],
): Promise<CurrentQuote[]> {
  if (transport !== fetch) {
    transport = fetch;
    provider = new VpsProvider(fetch, {
      ...defaultHttpOptions,
      ttlMs: 5000,
      retries: 0,
      timeoutMs: 12000,
    });
    pending = new Map();
    failures = new Map();
  }
  const wanted = validatedSymbols(symbols),
    key = wanted.join(',');
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 2)
    return Promise.reject(
      new Error('Đang lấy giá cho lô khác; sẽ tự thử lại.'),
    );
  for (const [k, expiry] of failures)
    if (expiry <= Date.now()) failures.delete(k);
  if ((failures.get(key) ?? 0) > Date.now())
    return Promise.reject(
      new Error('Nguồn giá đang tạm gián đoạn; sẽ tự thử lại.'),
    );
  const result = provider
    .fetchQuotes(wanted)
    .catch((error: unknown) => {
      if (failures.size >= 100) failures.delete(failures.keys().next().value!);
      failures.set(key, Date.now() + 10000);
      throw error;
    })
    .finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}
export function quoteRow(q: CurrentQuote) {
  return {
    symbol: q.symbol,
    reference_vnd: q.referenceVnd,
    ceiling_vnd: q.ceilingVnd,
    floor_vnd: q.floorVnd,
    last_price_vnd: q.lastPriceVnd,
    bid3_price_vnd: q.bid3PriceVnd,
    last_volume_raw: q.volumeRaw.lastVolume,
    lot_raw: q.volumeRaw.lot,
    total_volume_shares: q.totalVolumeShares,
    fetched_at: q.fetchedAt,
  };
}
export async function persistQuotes(
  db: SupabaseClient,
  quotes: CurrentQuote[],
) {
  const { error } = await db.rpc('ingest_current_quotes', {
    rows: quotes.map(quoteRow),
  });
  if (error) throw new Error('Không lưu được snapshot giá; giữ thời điểm cũ.');
}
