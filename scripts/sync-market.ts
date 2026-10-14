import { providers } from '../modules/providers/registry';
import { normalizeSearch } from '../modules/market/search';
import { vietnamDate, yearsBefore } from '../modules/market/calendar';
import { validatedSymbols } from '../modules/providers/vps-provider';
import { databaseQuery, sqlJson, migrateHosted } from './management';

async function main() {
  if (process.argv.includes('--migrate')) await migrateHosted();
  const provider = providers({
    CATALOG_PROVIDER: process.env.CATALOG_PROVIDER ?? 'kbs',
    HISTORY_PROVIDER: process.env.HISTORY_PROVIDER ?? 'vps',
    QUOTE_PROVIDER: process.env.QUOTE_PROVIDER ?? 'vps',
  });
  const stocks = await provider.catalog.fetchStocks();
  if (stocks.length < 100)
    throw new Error('Danh mục quá ngắn, không ghi đè catalog');
  const rows = stocks.map((s) => ({
    ...s,
    search_text: normalizeSearch(s.symbol + ' ' + s.name),
  }));
  await databaseQuery(
    `select public.reconcile_stock_catalog(${sqlJson(rows)},true,'${stocks[0]!.fetchedAt}'::timestamptz);`,
  );
  console.log(
    `CATALOG SYNC PASS: ${stocks.length} cổ phiếu thật từ KBS (HOSE/HNX/UPCOM)`,
  );
  const symbols = validatedSymbols(
    (process.env.SYNC_SYMBOLS ?? 'VNM,FPT,HPG').split(','),
  );
  const to = vietnamDate(Date.now());
  const from = process.env.SYNC_FROM ?? yearsBefore(to, 3);
  for (const symbol of symbols) {
    if (!stocks.some((s) => s.symbol === symbol))
      throw new Error('Mã không thuộc catalog đã xác minh');
    const profile = await provider.profile.fetchProfile(symbol);
    const bars = await provider.history.fetchHistory(symbol, from, to);
    if (!bars.length)
      throw new Error(`${symbol}: nguồn không trả lịch sử, không báo success`);
    await databaseQuery(
      `insert into public.prices_history(stock_id,session_date,source,open_vnd,high_vnd,low_vnd,close_vnd,volume_reported,is_final,fetched_at) select s.id,r."sessionDate"::date,r.source,r."openVnd",r."highVnd",r."lowVnd",r."closeVnd",r."volumeReported",r."isFinal",r."fetchedAt"::timestamptz from jsonb_to_recordset(${sqlJson(bars)}) as r(symbol text,"sessionDate" text,source text,"openVnd" numeric,"highVnd" numeric,"lowVnd" numeric,"closeVnd" numeric,"volumeReported" bigint,"isFinal" boolean,"fetchedAt" text) join public.stocks s on s.symbol=r.symbol on conflict(stock_id,source,session_date) do update set open_vnd=excluded.open_vnd,high_vnd=excluded.high_vnd,low_vnd=excluded.low_vnd,close_vnd=excluded.close_vnd,volume_reported=excluded.volume_reported,is_final=excluded.is_final,fetched_at=excluded.fetched_at where excluded.fetched_at > public.prices_history.fetched_at;`,
    );
    const [q] = await provider.quotes.fetchQuotes([symbol]);
    if (!q) throw new Error('Thiếu quote');
    await databaseQuery(
      `select public.ingest_current_quotes(${sqlJson([{ symbol: q.symbol, reference_vnd: q.referenceVnd, ceiling_vnd: q.ceilingVnd, floor_vnd: q.floorVnd, last_price_vnd: q.lastPriceVnd, bid3_price_vnd: q.bid3PriceVnd, last_volume_raw: q.volumeRaw.lastVolume, lot_raw: q.volumeRaw.lot, fetched_at: q.fetchedAt }])});`,
    );
    console.log(
      `MARKET SYNC PASS: ${symbol}, ${profile.name}, ${bars.length} bar ${bars[0]!.sessionDate} → ${bars.at(-1)!.sessionDate}; quote VPS thật`,
    );
  }
  await databaseQuery(
    "update public.system_status set state='ok',last_success_at=now(),updated_at=now() where component='prices';",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Market sync thất bại',
  );
  process.exitCode = 1;
});
