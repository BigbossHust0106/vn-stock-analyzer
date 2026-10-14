import { rankingUniverse } from '../../modules/market/ranking-universe';
import { createClient } from '@supabase/supabase-js';
import { RankingMetadataProvider } from '../../modules/providers/ranking-metadata';
import { validatedSymbols } from '../../modules/providers/vps-provider';
import deployment from '../../config/public-deployment.json';
import type { Env } from './index';
const provider = new RankingMetadataProvider();
export async function syncMetadata(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu quyền đồng bộ metadata');
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const reference = await provider.referencePrices();
  const { data: stocks, error: stockError } = await db
    .from('stocks')
    .select('id,symbol')
    .order('symbol')
    .limit(2000);
  if (stockError || !stocks)
    throw new Error('Không đọc được catalog reference');
  const ids = new Map(stocks.map((s) => [s.symbol, s.id]));
  const references = reference.rows
    .filter((r) => ids.has(r.symbol))
    .map((r) => ({
      stock_id: ids.get(r.symbol),
      reference_vnd: r.reference_vnd,
      source_url: reference.source,
      fetched_at: reference.fetchedAt,
    }));
  for (let start = 0; start < references.length; start += 300) {
    const { error } = await db
      .from('ranking_reference_prices')
      .upsert(references.slice(start, start + 300));
    if (error) throw new Error('Không ghi được giá tham chiếu');
  }
  for (const sector of await provider.sectors()) {
    if (!sector.symbols.length) continue;
    const { error } = await db
      .from('stocks')
      .update({ sector: sector.name, sector_source_url: sector.source })
      .in('symbol', sector.symbols);
    if (error) throw new Error('Không lưu được ngành KBS');
  }
  for (const symbol of validatedSymbols(
    (env.SYNC_SYMBOLS || rankingUniverse).split(','),
  )) {
    const { data: stock, error } = await db
      .from('stocks')
      .select('id')
      .eq('symbol', symbol)
      .eq('active', true)
      .maybeSingle();
    if (error || !stock) throw new Error('Mã metadata không hợp lệ');
    const events = await provider.events(symbol, new Date().toISOString());
    if (events.length) {
      const { error: writeError } = await db.from('corporate_events').upsert(
        events.map((e) => ({ ...e, stock_id: stock.id })),
        { onConflict: 'stock_id,kind,event_date,source_url' },
      );
      if (writeError) {
        console.warn(`Sự kiện ${symbol}: DB ${writeError.code}`);
        throw new Error('Không ghi được sự kiện');
      }
    }
  }
}
