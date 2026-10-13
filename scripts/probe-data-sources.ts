import {
  compareDailyEvidence,
  parseKbsDailyEvidence,
  parseVietcapDailyEvidence,
  validSourceDate,
} from '../modules/providers/source-evidence';
import { validatedSymbols } from '../modules/providers/vps-provider';

async function jsonRequest(url: string, payload?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}
async function main() {
  const day = process.env.SOURCE_PROBE_DATE ?? '2026-10-12';
  const symbols = validatedSymbols(
    (process.env.SOURCE_PROBE_SYMBOLS ?? 'ACB,FPT,SHS,QNS').split(','),
  );
  if (!validSourceDate(day) || symbols.length > 10)
    throw new Error('Cần ngày YYYY-MM-DD và tối đa 10 mã');
  const [year, month, date] = day.split('-');
  const to = Math.floor(
    (Date.parse(`${day}T00:00:00+07:00`) + 24 * 60 * 60 * 1000) / 1000,
  );
  let review = false;
  console.log(
    `SOURCE PROBE: phiên ${day}, chỉ đọc; không ghi Supabase hoặc tự đổi provider`,
  );
  console.log('| Mã | OHLC khớp | Volume KBS | Volume Vietcap | Kết quả |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const symbol of symbols) {
    // Query/payload đã tìm thấy trong mã nguồn và thử thật; không dùng thư viện Vnstock.
    const kbsUrl = new URL(
      `https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/${symbol}/data_day`,
    );
    kbsUrl.searchParams.set('sdate', `${date}-${month}-${year}`);
    kbsUrl.searchParams.set('edate', `${date}-${month}-${year}`);
    const kbs = parseKbsDailyEvidence(
      await jsonRequest(kbsUrl.toString()),
      symbol,
    ).find((b) => b.sessionDate === day);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const vci = parseVietcapDailyEvidence(
      await jsonRequest(
        'https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart',
        { timeFrame: 'ONE_DAY', symbols: [symbol], to, countBack: 5 },
      ),
      symbol,
    ).find((b) => b.sessionDate === day);
    if (!kbs || !vci) throw new Error(`Thiếu bar cùng ngày: ${symbol}`);
    const compared = compareDailyEvidence(kbs, vci);
    const status =
      compared.pricesMatch && compared.volumeMatch ? 'MATCH' : 'REVIEW_NEEDED';
    console.log(
      `| ${symbol} | ${compared.pricesMatch} | ${kbs.volumeReported} | ${vci.volumeReported} | ${status} |`,
    );
    review ||= status === 'REVIEW_NEEDED';
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(
    'Price basis, volume definition và quyền dùng production chưa được chứng nhận.',
  );
  if (review) process.exitCode = 2;
}
main().catch(() => {
  console.error(
    'SOURCE PROBE FAIL: dữ liệu/mạng không hợp lệ; kiểm tra nguồn, không dùng kết quả để tự fallback.',
  );
  process.exitCode = 1;
});
