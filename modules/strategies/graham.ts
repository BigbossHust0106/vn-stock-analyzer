import { parentEvidence } from '../providers/document-evidence';
import type { FinancialData } from '../providers/financial-types';
import { grahamNumber } from './valuation';
import { marginOfSafety } from '../scoring/margin-of-safety';
import { positive, insufficient } from './result';
import {
  availableAnnual,
  consecutiveSeries,
  criterion,
  ratio,
  strategyResult,
} from './strategy';
export function graham(
  data: FinancialData | null,
  priceVnd: number | null,
  asOf: string,
) {
  const rows = availableAnnual(data, asOf),
    last = rows.at(-1);
  const comparable =
    !!last &&
    positive(last.sharesOutstanding) &&
    last.sharesOutstanding === data?.currentShares;
  const eps = comparable ? last.epsAnnualVnd : null,
    bvps = comparable ? last.bvpsVnd : null;
  const pe = positive(eps) && positive(priceVnd) ? ratio(priceVnd, eps) : null,
    pb = positive(bvps) && positive(priceVnd) ? ratio(priceVnd, bvps) : null;
  const intrinsic = grahamNumber(eps, bvps),
    mos = marginOfSafety(intrinsic.ok ? intrinsic.value : null, priceVnd);
  const current = ratio(last?.currentAssetsVnd, last?.currentLiabilitiesVnd);
  const working =
    last?.currentAssetsVnd != null && last.currentLiabilitiesVnd != null
      ? last.currentAssetsVnd - last.currentLiabilitiesVnd
      : null;
  const debt = last?.longTermLiabilitiesVnd;
  const profits = consecutiveSeries(rows, (r) => r.parentProfitVnd),
    dividends = consecutiveSeries(
      rows,
      (r) =>
        parentEvidence(data?.documentEvidence, r.year, asOf)
          ?.dividendsPaidVnd ??
        (r.minorityEquityVnd === 0 ? r.dividendsPaidVnd : null),
    );
  const criteria = [
    criterion(
      'multiples',
      'P/E < 15 và P/B < 1,5; hoặc tích < 22,5',
      20,
      pe === null || pb === null
        ? null
        : pe > 0 && pb > 0 && ((pe < 15 && pb < 1.5) || pe * pb < 22.5),
      `P/E=${pe?.toFixed(2) ?? '—'}, P/B=${pb?.toFixed(2) ?? '—'}. Dùng EPS năm; không nhân EPS quý với 4. Khi số cổ phiếu thay đổi, tạm dừng định giá Graham.`,
    ),
    criterion(
      'graham-value',
      'Giá thấp hơn Graham Number',
      15,
      intrinsic.ok && positive(priceVnd) ? priceVnd < intrinsic.value : null,
      'Graham Number = √(22,5 × EPS năm × BVPS thuộc cổ đông công ty mẹ).',
    ),
    criterion(
      'liquidity',
      'Thanh toán hiện hành > 2',
      15,
      current === null ? null : current > 2,
      `Tài sản ngắn hạn / nợ ngắn hạn = ${current?.toFixed(2) ?? '—'}.`,
    ),
    criterion(
      'long-debt',
      'Nợ dài hạn thấp hơn vốn lưu động',
      15,
      debt == null || working === null || !Number.isFinite(working)
        ? null
        : working > 0 && debt >= 0 && debt < working,
      'Dùng toàn bộ nợ dài hạn / (tài sản ngắn hạn − nợ ngắn hạn); vốn lưu động âm không đạt.',
    ),
    criterion(
      'earnings',
      'Lợi nhuận công ty mẹ dương 3 năm liên tiếp',
      15,
      profits ? profits.every(positive) : null,
      'Mô hình sàng lọc rút gọn dùng 3 năm liên tiếp, chưa đáp ứng kiểm tra 10 năm của Graham nguyên bản.',
    ),
    criterion(
      'dividends',
      'Có chi trả cổ tức 3 năm liên tiếp',
      10,
      dividends ? dividends.every(positive) : null,
      'Dùng cổ tức đã trả trong BCTC riêng công ty mẹ khi có bằng chứng gốc; chỉ dùng dòng tiền hợp nhất nếu không có CĐ thiểu số. Chưa xác minh chuỗi 20 năm nguyên bản.',
    ),
    criterion(
      'safety',
      'Biên an toàn ≥ 25%',
      10,
      mos.ok ? mos.value >= 0.25 : null,
      '(Giá trị nội tại − giá) / giá trị nội tại. Ngưỡng 25% là lựa chọn sàng lọc của ứng dụng.',
    ),
  ];
  return strategyResult(
    'graham',
    'Benjamin Graham',
    criteria,
    intrinsic.ok ? intrinsic : insufficient(),
    mos,
    'Graham Number · EPS năm / BVPS công ty mẹ',
  );
}
