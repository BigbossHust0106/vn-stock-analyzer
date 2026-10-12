import { VpsProvider } from '../modules/providers/vps-provider';
async function main() {
  const symbols = (process.env.VPS_LIVE_SYMBOLS ?? 'ACB').split(',');
  const prices = await new VpsProvider().fetchQuotes(symbols);
  console.log(
    `VPS LIVE PASS: ${prices.length} mã; giá VND, lot × 10 (1 mã/1 ngày), lastVolume chưa xác minh; fetchedAt không phải thời điểm giao dịch`,
  );
}
main().catch(() => {
  console.error(
    'VPS LIVE FAIL: kiểm tra quyền truy cập và wire schema; không in credential hay payload.',
  );
  process.exitCode = 1;
});
