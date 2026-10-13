import { providers } from '../modules/providers/registry';
import { validatedSymbols } from '../modules/providers/vps-provider';
import { isFinancialData } from '../modules/providers/financial-types';
async function main() {
  const provider = providers({
    FUNDAMENTALS_PROVIDER: process.env.FUNDAMENTALS_PROVIDER ?? 'kbs',
  });
  for (const symbol of validatedSymbols(
    (process.env.SYNC_SYMBOLS ?? 'VNM,FPT,HPG').split(','),
  )) {
    const f = await provider.fundamentals.fetchFinancials(symbol);
    if (!isFinancialData(f) || !f.annual.length)
      throw new Error(`${symbol}: không có BCTC năm hợp lệ`);
    console.log(
      `FINANCIAL LIVE PASS: ${symbol}, ${f.annual.length} kỳ năm, EPS năm ${f.annual.at(-1)!.epsAnnualVnd} VND; provider_reported, chưa chứng nhận PDF gốc`,
    );
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Financial live thất bại');
  process.exitCode = 1;
});
