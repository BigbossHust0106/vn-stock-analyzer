import { ioPolicy } from '../../modules/market/io-policy';
import type { SupabaseClient } from '@supabase/supabase-js';
// Explicit pagination: PostgREST's default row cap must not silently exclude
// the second half of the market. A failed page invalidates this queue read.
export async function financialCatalog(db: SupabaseClient) {
  const stocks: { id: string; symbol: string }[] = [];
  const fetched = new Map<string, string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from('stocks')
      .select('id,symbol')
      .eq('active', true)
      .order('symbol')
      .range(offset, offset + 499);
    if (error || !Array.isArray(data))
      throw Error('Không đọc được danh mục BCTC đầy đủ');
    stocks.push(
      ...data.map((s) => ({ id: String(s.id), symbol: String(s.symbol) })),
    );
    if (data.length < 500) break;
  }
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from('financial_snapshots')
      .select('stock_id,fetched_at')
      .order('stock_id')
      .range(offset, offset + 499);
    if (error || !Array.isArray(data))
      throw Error('Không đọc được thời điểm BCTC đầy đủ');
    for (const s of data) fetched.set(String(s.stock_id), String(s.fetched_at));
    if (data.length < 500) break;
  }
  return { stocks, fetched };
}

// Online scheduler: two small indexed reads, never enumerate the whole market.
// The old full reader above remains available only for explicit offline audits.
export async function financialTurn(db: SupabaseClient, stamp: number) {
  const { data: state, error } = await db
    .from('catalog_sync_state')
    .select('row_count')
    .eq('source', 'KBS')
    .maybeSingle();
  if (error) throw Error('Không đọc được kích thước danh mục');
  let count = Number(state?.row_count ?? 0);
  if (!Number.isSafeInteger(count) || count < 1) {
    const r = await db
      .from('stocks')
      .select('id', { head: true, count: 'exact' })
      .eq('active', true)
      .eq('source', 'KBS');
    if (r.error || r.count === null)
      throw Error('Không đọc được kích thước danh mục');
    count = r.count;
  }
  if (!count) return null;
  const slot = Math.floor(stamp / ioPolicy.financialSlotsMs) % count;
  const r = await db
    .from('stocks')
    .select('id,symbol,financial_snapshots(fetched_at)')
    .eq('active', true)
    .eq('source', 'KBS')
    .order('symbol')
    .range(slot, slot);
  if (r.error || !Array.isArray(r.data))
    throw Error('Không đọc được lượt BCTC');
  const row = r.data[0];
  if (!row) return null; // Catalog changed between reads: retry next turn, no scan fallback.
  const f = row.financial_snapshots as unknown as {
    fetched_at?: string;
  } | null;
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    fetchedAt: f?.fetched_at ?? null,
  };
}
