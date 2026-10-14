import { rankingUniverse } from '../modules/market/ranking-universe';
import { syncMetadata } from '../worker/src/metadata-sync';
import { createClient } from '@supabase/supabase-js';
import { databaseQuery, sqlJson, migrateHosted } from './management';
import { rankingRows } from '../worker/src/ranking-sync';
import { syncFinancials } from '../worker/src/financial-sync';
import { marketProviders } from '../worker/src/api/market';
import { validatedSymbols } from '../modules/providers/vps-provider';
import { vietnamDate } from '../modules/market/calendar';
export const phase4Symbols = rankingUniverse;
export async function managementClient() {
  const ref = process.env.SUPABASE_PROJECT_REF,
    token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !token)
    throw new Error('Thiếu quyền quản trị Supabase');
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error('Không đọc được key quản trị Supabase; không in phản hồi');
  const keys: unknown = await response.json();
  if (!Array.isArray(keys)) throw new Error('Metadata key không hợp lệ');
  const key = keys.find(
    (k) => k.name === 'service_role' && typeof k.api_key === 'string',
  )?.api_key as string | undefined;
  if (!key) throw new Error('Thiếu service_role cho đồng bộ server');
  const claims = JSON.parse(
    Buffer.from(key.split('.')[1] ?? '', 'base64url').toString(),
  ) as { ref: string; role: string };
  if (claims.ref !== ref || claims.role !== 'service_role')
    throw new Error('Key không đúng project/role');
  return {
    key,
    url: `https://${ref}.supabase.co`,
    db: createClient(`https://${ref}.supabase.co`, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
async function main() {
  if (process.argv.includes('--migrate')) await migrateHosted();
  const { db, key, url } = await managementClient();
  if (process.argv.includes('--refresh')) {
    const symbols = validatedSymbols(
      (process.env.SYNC_SYMBOLS || phase4Symbols).split(','),
    );
    try {
      const quotes = await marketProviders({}).quotes.fetchQuotes(symbols);
      const { error } = await db.rpc('ingest_current_quotes', {
        rows: quotes.map((q) => ({
          symbol: q.symbol,
          reference_vnd: q.referenceVnd,
          ceiling_vnd: q.ceilingVnd,
          floor_vnd: q.floorVnd,
          last_price_vnd: q.lastPriceVnd,
          bid3_price_vnd: q.bid3PriceVnd,
          last_volume_raw: q.volumeRaw.lastVolume,
          lot_raw: q.volumeRaw.lot,
          fetched_at: q.fetchedAt,
        })),
      });
      if (error) throw new Error('Không ghi được quotes xếp hạng');
      console.log(
        `QUOTES SYNC PASS: ${quotes.length} mã thật; không nhập lịch sử unverified vào scoring`,
      );
    } catch {
      console.warn(
        'VPS quotes chưa khả dụng; giữ giá nguồn cũ, dùng tham chiếu có nhãn khi có.',
      );
    }
    await syncFinancials({
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      SYNC_SYMBOLS: symbols.join(','),
    });
  }
  if (process.argv.includes('--metadata'))
    await syncMetadata({
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      SYNC_SYMBOLS: process.env.SYNC_SYMBOLS || phase4Symbols,
    });
  const stamp = Date.now(),
    rows = await rankingRows(db, stamp);
  await databaseQuery(
    `select public.publish_rankings('${vietnamDate(stamp)}','${new Date(stamp).toISOString()}',${sqlJson(rows)});`,
  );
  const summary = await databaseQuery(
    "select horizon,count(*) from public.rankings where model_version='top10-v1' and as_of=(select max(as_of) from public.ranking_runs where model_version='top10-v1') group by horizon order by horizon",
    true,
  );
  console.log('RANKINGS SYNC PASS:', summary);
}
if (process.argv[1]?.endsWith('/sync-rankings.ts'))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : 'Đồng bộ xếp hạng thất bại');
    process.exitCode = 1;
  });
