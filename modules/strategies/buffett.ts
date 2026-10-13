import type { FinancialData } from '../providers/financial-types';
import type { ScoringSettings } from '../settings/scoring-settings';
import { validateSettings } from '../settings/scoring-settings';
import { positive, insufficient, type Result } from './result';
import { dcf } from './valuation';
import { marginOfSafety } from '../scoring/margin-of-safety';
import {
  availableAnnual,
  consecutiveSeries,
  criterion,
  strategyResult,
} from './strategy';
export function ownerEarningsDcf(
  earningsVnd: number | null,
  shares: number | null,
  settings: ScoringSettings,
): Result<number> {
  if (
    !positive(earningsVnd) ||
    !positive(shares) ||
    !validateSettings(settings)
  )
    return insufficient();
  const flows = Array.from(
    { length: settings.projectionYears },
    (_, i) => earningsVnd * (1 + settings.growthRate) ** (i + 1),
  );
  return dcf(flows, settings.discountRate, settings.terminalGrowth, shares);
}
export function buffett(
  data: FinancialData | null,
  priceVnd: number | null,
  asOf: string,
  settings: ScoringSettings,
) {
  const rows = availableAnnual(data, asOf),
    last = rows.at(-1);
  const roe = consecutiveSeries(rows, (r) => r.roe),
    gross = consecutiveSeries(rows, (r) => r.grossMargin),
    net = consecutiveSeries(rows, (r) => r.netMargin),
    fcf = consecutiveSeries(rows, (r) => r.freeCashFlowVnd),
    earnings = consecutiveSeries(rows, (r) => r.parentProfitVnd);
  const stableHigh = (values: number[] | null, minimum: number) =>
    values
      ? values.every((v) => v > minimum) &&
        Math.max(...values) - Math.min(...values) <= 0.05
      : null;
  const growing = (values: number[] | null) =>
    values
      ? values.every((v, i) => positive(v) && (i === 0 || v > values[i - 1]!))
      : null;
  const cash = last?.operatingCashFlowVnd,
    capex = last?.capexVnd;
  const proxy =
    cash != null &&
    capex != null &&
    Number.isFinite(cash) &&
    Number.isFinite(capex)
      ? cash - capex * settings.maintenanceCapexFraction
      : null;
  const intrinsic = ownerEarningsDcf(
      proxy,
      data?.currentShares ?? null,
      settings,
    ),
    mos = marginOfSafety(intrinsic.ok ? intrinsic.value : null, priceVnd);
  const criteria = [
    criterion(
      'roe',
      'ROE > 15%, ổn định 3 năm',
      20,
      stableHigh(roe, 0.15),
      'ROE năm trên vốn chủ bình quân; chênh lệch cao nhất/thấp nhất ≤ 5 điểm phần trăm.',
    ),
    criterion(
      'roic',
      'ROIC > 15%',
      15,
      last?.roic == null ? null : last.roic > 0.15,
      'ROIC năm theo Vietcap RATIO_YEAR; không thay ROIC bằng ROCE. Định nghĩa vốn đầu tư chưa đối chiếu báo cáo gốc.',
    ),
    criterion(
      'margins',
      'Biên gộp > 20%, biên ròng > 10%, ổn định',
      15,
      gross && net
        ? stableHigh(gross, 0.2) === true && stableHigh(net, 0.1) === true
        : null,
      'Đối chiếu 3 năm liên tiếp; độ dao động mỗi biên ≤ 5 điểm phần trăm. Đây là ngưỡng ứng dụng, không phải quy tắc chung của Buffett.',
    ),
    criterion(
      'debt',
      'Nợ vay / vốn chủ < 50%',
      15,
      last?.debtToEquity == null
        ? null
        : last.debtToEquity >= 0 && last.debtToEquity < 0.5,
      'Dùng nợ vay, không trộn với toàn bộ nợ phải trả.',
    ),
    criterion(
      'fcf',
      'FCF dương và tăng 3 năm liên tiếp',
      15,
      growing(fcf),
      'FCF = CFO − tiền đầu tư TSCĐ/tài sản dài hạn. Không gọi FCF này là FCFE.',
    ),
    criterion(
      'growth',
      'Lợi nhuận công ty mẹ tăng bền vững',
      10,
      growing(earnings),
      'Lợi nhuận dương và tăng từng năm trong 3 năm liên tiếp; không coi doanh thu tăng là lợi nhuận tăng.',
    ),
    criterion(
      'dcf',
      'Giá thấp hơn DCF ước tính, biên an toàn ≥ 25%',
      10,
      mos.ok ? mos.value >= 0.25 : null,
      'DCF chiết khấu proxy CFO − vốn đầu tư duy trì giả định. Chưa tách tiền của CĐ thiểu số; không phải Owner Earnings đã xác minh.',
    ),
  ];
  return strategyResult(
    'buffett',
    'Warren Buffett',
    criteria,
    intrinsic,
    mos,
    'DCF ước tính · proxy CFO − Capex duy trì',
  );
}
