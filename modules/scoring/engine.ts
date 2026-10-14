import type { FinancialData } from '../providers/financial-types';
import {
  defaultSettings,
  validateSettings,
  type ScoringSettings,
} from '../settings/scoring-settings';
import { graham } from '../strategies/graham';
import { buffett } from '../strategies/buffett';
import { vietnamDate } from '../market/calendar';
import { positive } from '../strategies/result';
export type Conclusion = 'Mua' | 'Tích lũy' | 'Nắm giữ' | 'Quan sát' | 'Tránh';
export function conclusion(
  score: number | null,
  confidence: number,
  safety: number | null,
): Conclusion {
  if (score === null || confidence < 70 || safety === null) return 'Quan sát';
  if (score < 35 || safety < -0.2) return 'Tránh';
  if (score >= 80 && safety >= 0.25) return 'Mua';
  if (score >= 65 && safety >= 0.1) return 'Tích lũy';
  if (score >= 50 && safety >= 0) return 'Nắm giữ';
  return 'Quan sát';
}
export interface QuoteEvidence {
  sourceTimestamp: string | null;
  sessionDate: string | null;
  verification: 'verified' | 'unverified';
}
export function scoreStock(
  data: FinancialData | null,
  priceVnd: number | null,
  asOf: string,
  settings: ScoringSettings = defaultSettings,
  quoteFetchedAt: string | null = null,
  quoteEvidence: QuoteEvidence | null = null,
) {
  if (!validateSettings(settings))
    throw new Error('Trọng số/giả định DCF không hợp lệ');
  const strategies = [
    graham(data, priceVnd, asOf),
    buffett(data, priceVnd, asOf, settings),
  ];
  const weights = [settings.grahamWeight / 100, settings.buffettWeight / 100];
  const coverage = strategies.reduce(
    (s, r, i) => s + r.coverage * weights[i]!,
    0,
  );
  const score =
    coverage === 0
      ? null
      : Math.round(
          strategies.reduce((s, r, i) => s + r.score * weights[i]!, 0) * 100,
        ) / 100;
  const sourceTimestamp = quoteEvidence?.sourceTimestamp ?? null;
  const sourceTime =
    sourceTimestamp === null ? NaN : Date.parse(sourceTimestamp);
  const validQuote =
    positive(priceVnd) &&
    quoteEvidence?.verification === 'verified' &&
    Number.isFinite(sourceTime) &&
    sourceTime <= Date.parse(asOf) &&
    Date.parse(asOf) - sourceTime <= 86400000 &&
    quoteEvidence.sessionDate === vietnamDate(sourceTime);
  const last = data?.annual.at(-1);
  const fresh =
    last &&
    Date.parse(asOf) - Date.parse(last.periodEnd + 'T00:00:00+07:00') <=
      550 * 86400000;
  // Confidence là mức hoàn thiện bằng chứng, không phải xác suất lợi nhuận.
  const confidence = Math.round(
    100 *
      coverage *
      (validQuote ? 1 : 0.4) *
      (fresh ? 1 : 0.5) *
      0.65 *
      (settings.buffettWeight > 0 ? 0.8 : 1),
  );
  const valuationSafety = strategies
    .filter((s, i) => weights[i]! > 0)
    .map((s) => (s.marginOfSafety.ok ? s.marginOfSafety.value : null));
  const safety = valuationSafety.every((v): v is number => v !== null)
    ? Math.min(...valuationSafety)
    : null;
  const risks = [
    ...new Set([
      ...(data?.notices ?? ['Chưa có BCTC được chuẩn hóa.']),
      ...(!validQuote
        ? [
            'Giá thiếu, timestamp nguồn chưa xác minh hoặc quá 24 giờ; fetchedAt chỉ là thời gian tải, không chứng minh giá mới.',
          ]
        : []),
      ...(!fresh ? ['BCTC thiếu hoặc quá 550 ngày kể từ cuối kỳ.'] : []),
      ...(coverage < 1
        ? [
            'Thiếu tiêu chí được ghi rõ; không tự tăng trọng số tiêu chí còn lại.',
          ]
        : []),
      ...(!positive(last?.sharesOutstanding) || !positive(data?.currentShares)
        ? [
            'Thiếu số cổ phiếu để đối chiếu EPS/BVPS; không kết luận số cổ phiếu đã thay đổi.',
          ]
        : last!.sharesOutstanding !== data!.currentShares
          ? [
              'Số cổ phiếu thay đổi theo hai kỳ nguồn: chưa xác minh EPS/BVPS điều chỉnh nên tạm dừng Graham.',
            ]
          : []),
      ...(settings.buffettWeight > 0
        ? [
            'DCF rất nhạy với giả định; CFO hợp nhất chưa tách CĐ thiểu số, vốn đầu tư duy trì chưa xác minh.',
          ]
        : []),
    ]),
  ];
  return {
    modelVersion: 'graham-buffett-v2-review',
    quoteEvidence: {
      fetchedAt: quoteFetchedAt,
      sourceTimestamp,
      sessionDate: quoteEvidence?.sessionDate ?? null,
      verification: quoteEvidence?.verification ?? 'unverified',
    },
    asOf,
    settings,
    strategies,
    score,
    coverage,
    confidence,
    confidenceLabel: 'Mức hoàn thiện bằng chứng, không phải xác suất sinh lời',
    conclusion: conclusion(score, confidence, safety),
    risks,
  };
}
export type ScoreReport = ReturnType<typeof scoreStock>;
