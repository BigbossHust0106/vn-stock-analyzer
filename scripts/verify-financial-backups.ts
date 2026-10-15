import {
  VietcapReportsProvider,
  reportSections,
} from '../modules/providers/financial-backup';
import { validatedSymbols } from '../modules/providers/vps-provider';
const provider = new VietcapReportsProvider();
for (const symbol of validatedSymbols(
  (process.env.SYNC_SYMBOLS ?? 'VNM,FPT,HPG').split(','),
)) {
  const start = Date.now();
  const d = await provider.fetchFinancialReports(symbol);
  for (const section of reportSections) {
    const rows = d.reports[section];
    if (!rows.length) throw Error('Empty backup ' + symbol + section);
  }
  console.log(
    JSON.stringify({
      symbol,
      source: d.source,
      ms: Date.now() - start,
      annualPeriods: Object.fromEntries(
        reportSections.map((s) => [s, d.reports[s].map((r) => r.year)]),
      ),
      verification: d.verification,
      usableForScoring: d.usableForScoring,
    }),
  );
}
