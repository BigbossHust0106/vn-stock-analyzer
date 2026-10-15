import { VietcapReportsProvider } from '../modules/providers/financial-backup';
import { providers } from '../modules/providers/registry';
import { validatedSymbols } from '../modules/providers/vps-provider';
import { databaseQuery, sqlJson, migrateHosted } from './management';
import { scoreStock } from '../modules/scoring/engine';
import { financialRegression } from '../modules/providers/financial-types';
import { defaultScoreRow } from '../worker/src/financial-sync';
async function main() {
  if (process.argv.includes('--migrate')) await migrateHosted();
  const provider = providers({
    FUNDAMENTALS_PROVIDER: process.env.FUNDAMENTALS_PROVIDER ?? 'kbs',
  });
  const backupProvider = new VietcapReportsProvider();
  for (const symbol of validatedSymbols(
    (process.env.SYNC_SYMBOLS ?? 'VNM,FPT,HPG').split(','),
  )) {
    const existing = await databaseQuery(
      `select s.id,q.version as quote_version,q.last_price_vnd::float8 as last_price_vnd,to_char(q.fetched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as fetched_at from public.stocks s left join public.prices_current q on q.stock_id=s.id where s.symbol=${sqlJson(symbol)} #>> '{}' and s.active=true`,
      true,
    );
    if (!Array.isArray(existing) || existing.length !== 1)
      throw new Error('Mã không thuộc catalog');
    try {
      const backup = await backupProvider.fetchFinancialReports(symbol);
      await databaseQuery(
        `insert into public.financial_report_backups(stock_id,source,fetched_at,payload) values ('${existing[0].id}'::uuid,'VIETCAP_REPORTS',(${sqlJson(backup.fetchedAt)} #>> '{}')::timestamptz,${sqlJson(backup)}) on conflict(stock_id,source) do update set fetched_at=excluded.fetched_at,payload=excluded.payload,last_error=null;`,
      );
      console.log(
        `FINANCIAL BACKUP PASS: ${symbol}, Vietcap 3 báo cáo; raw, không dùng chấm điểm`,
      );
    } catch {
      console.warn(`FINANCIAL BACKUP FAIL: ${symbol}; giữ bản đã lưu`);
    }
    const f = await provider.fundamentals.fetchFinancials(symbol);
    if (!f.annual.length)
      throw new Error('Nguồn không trả BCTC năm; không báo thành công');
    const previous = await databaseQuery(
      `select payload from public.financial_snapshots where stock_id='${existing[0].id}'::uuid`,
      true,
    );
    if (
      Array.isArray(previous) &&
      previous[0] &&
      financialRegression(previous[0].payload, f)
    )
      throw new Error('Snapshot mới thiếu trường; giữ BCTC và điểm cũ');
    const report = scoreStock(
      f,
      existing[0].last_price_vnd ?? null,
      new Date().toISOString(),
      undefined,
      existing[0].fetched_at ?? null,
    );
    const row = defaultScoreRow(
      existing[0].id,
      f,
      report,
      existing[0].quote_version ?? null,
    );
    await databaseQuery(
      `select public.persist_financial_score(${sqlJson(f)},${sqlJson(row)});`,
    );
    console.log(
      `FINANCIAL SYNC PASS: ${symbol}, ${f.annual.length} kỳ năm thật, ${f.annual[0]!.year}–${f.annual.at(-1)!.year}; điểm=${report.score}, ${report.conclusion}, tin cậy ${report.confidence}%`,
    );
  }
  await databaseQuery(
    "update public.system_status set state='ok',last_success_at=now(),updated_at=now() where component='fundamentals';",
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Đồng bộ BCTC thất bại');
  process.exitCode = 1;
});
