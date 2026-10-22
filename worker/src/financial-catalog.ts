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
