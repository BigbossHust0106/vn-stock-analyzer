import { providers } from '../modules/providers/registry';
import { validatedSymbols } from '../modules/providers/vps-provider';
import { databaseQuery, sqlJson, migrateHosted } from './management';
import { scoreStock } from '../modules/scoring/engine';
import { defaultScoreRow } from '../worker/src/financial-sync';
async function main() {
  if (process.argv.includes('--migrate')) await migrateHosted();
  const provider = providers({
    FUNDAMENTALS_PROVIDER: process.env.FUNDAMENTALS_PROVIDER ?? 'kbs',
  });
  for (const symbol of validatedSymbols(
    (process.env.SYNC_SYMBOLS ?? 'VNM,FPT,HPG').split(','),
  )) {
    const existing = await databaseQuery(
      `select s.id,q.last_price_vnd::float8 as last_price_vnd,to_char(q.fetched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as fetched_at from public.stocks s left join public.prices_current q on q.stock_id=s.id where s.symbol=${sqlJson(symbol)} #>> '{}' and s.active=true`,
      true,
    );
    if (!Array.isArray(existing) || existing.length !== 1)
      throw new Error('Mã không thuộc catalog');
    const f = await provider.fundamentals.fetchFinancials(symbol);
    if (!f.annual.length)
      throw new Error('Nguồn không trả BCTC năm; không báo thành công');
    const report = scoreStock(
      f,
      existing[0].last_price_vnd ?? null,
      new Date().toISOString(),
      undefined,
      existing[0].fetched_at ?? null,
    );
    const row = defaultScoreRow(existing[0].id, f, report);
    await databaseQuery(
      `begin; select public.ingest_financials(${sqlJson(f)}); insert into public.scores(stock_id,as_of,horizon,model_version,value,insufficient_reason,inputs_as_of,computed_at,explanation) select r.stock_id::uuid,r.as_of::date,r.horizon::public.ranking_horizon,r.model_version,r.value,r.insufficient_reason,r.inputs_as_of::timestamptz,r.computed_at::timestamptz,r.explanation from jsonb_to_record(${sqlJson(row)}) as r(stock_id text,as_of text,horizon text,model_version text,value numeric,insufficient_reason text,inputs_as_of text,computed_at text,explanation jsonb) on conflict(stock_id,as_of,horizon,model_version) do update set value=excluded.value,insufficient_reason=excluded.insufficient_reason,inputs_as_of=excluded.inputs_as_of,computed_at=excluded.computed_at,explanation=excluded.explanation; commit;`,
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
