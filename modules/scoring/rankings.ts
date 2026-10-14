import type { FinancialData } from '../providers/financial-types';
import { scoreStock, type QuoteEvidence } from './engine';
import { availableAnnual } from '../strategies/strategy';
import { rsi, macd } from '../strategies/technical';
import { positive } from '../strategies/result';
import { vietnamDate } from '../market/calendar';
export const rankingModel = 'top10-v1';
export type Horizon = 'day' | 'month' | 'quarter';
export interface RankingBar {
  session_date: string;
  close_vnd: number;
  volume_shares: number;
  price_basis: 'adjusted' | 'unadjusted';
  source: string;
}
export interface RankingEvent {
  event_date: string;
  kind: 'earnings' | 'dividend' | 'agm';
  title: string;
  source_url: string;
  known_at: string;
}
export interface RankingInput {
  stockId: string;
  financials: FinancialData | null;
  priceVnd: number | null;
  referenceVnd: number | null;
  quoteFetchedAt: string | null;
  bars: RankingBar[];
  events: RankingEvent[];
  asOf: string;
  referenceOnly?: boolean;
  quoteEvidence?: QuoteEvidence;
  eventsChecked?: boolean;
}
function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
export function priceChange(
  price: number | null,
  reference: number | null,
): number | null {
  return positive(price) && positive(reference)
    ? round((price / reference - 1) * 100)
    : null;
}
export function technicalScores(bars: RankingBar[], asOf: string) {
  const missing = { short: null, medium: null, volume: null };
  const rows = [...bars].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  );
  if (rows.length < 51 || !Number.isFinite(Date.parse(asOf))) return missing;
  const latest = rows.at(-1)!;
  // Chỉ prices_daily đã có basis/lịch phiên được xác minh; không dùng prices_history unverified.
  if (
    rows.some(
      (b, i) =>
        !positive(b.close_vnd) ||
        !Number.isSafeInteger(b.volume_shares) ||
        b.volume_shares < 0 ||
        !['adjusted', 'unadjusted'].includes(b.price_basis) ||
        b.price_basis !== latest.price_basis ||
        b.source !== latest.source ||
        b.session_date > vietnamDate(Date.parse(asOf)) ||
        (i > 0 && b.session_date === rows[i - 1]!.session_date),
    ) ||
    Date.parse(asOf) - Date.parse(latest.session_date + 'T15:00:00+07:00') >
      7 * 86400000
  )
    return missing;
  const closes = rows.map((b) => b.close_vnd);
  const avg = (period: number) =>
    closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const strength = rsi(closes),
    trend = macd(closes);
  if (!strength.ok || !trend.ok) return missing;
  const short =
    (latest.close_vnd > avg(20) ? 40 : 0) +
    (strength.value >= 45 && strength.value <= 70 ? 30 : 0) +
    (trend.value.histogram > 0 ? 30 : 0);
  const medium =
    (latest.close_vnd > avg(50) ? 40 : 0) +
    (avg(20) > avg(50) ? 30 : 0) +
    (trend.value.macd > 0 ? 30 : 0);
  const baseline =
    rows.slice(-21, -1).reduce((a, b) => a + b.volume_shares, 0) / 20;
  return {
    short,
    medium,
    volume:
      baseline > 0
        ? round(clamp((latest.volume_shares / baseline - 1) * 50))
        : null,
  };
}
export function rankStock(input: RankingInput) {
  const { asOf, financials, priceVnd, referenceVnd, quoteFetchedAt } = input;
  const report = scoreStock(
    financials,
    priceVnd,
    asOf,
    undefined,
    quoteFetchedAt,
    input.quoteEvidence,
  );
  const annual = availableAnnual(financials, asOf).at(-1);
  const fresh =
    quoteFetchedAt &&
    Number.isFinite(Date.parse(quoteFetchedAt)) &&
    Date.parse(quoteFetchedAt) <= Date.parse(asOf) &&
    Date.parse(asOf) - Date.parse(quoteFetchedAt) <= 7 * 86400000;
  const cap =
    positive(priceVnd) && positive(financials?.currentShares)
      ? priceVnd * financials.currentShares
      : null;
  const eligible = !!(
    fresh &&
    annual &&
    positive(annual.epsAnnualVnd) &&
    positive(annual.bvpsVnd) &&
    positive(annual.parentProfitVnd) &&
    positive(annual.equityVnd) &&
    positive(priceVnd) &&
    priceVnd >= 1000 &&
    cap !== null &&
    Number.isFinite(cap) &&
    cap >= 1e11 &&
    Date.parse(asOf) - Date.parse(annual.periodEnd + 'T00:00:00+07:00') <=
      550 * 86400000
  );
  const graham = report.strategies[0]!,
    buffett = report.strategies[1]!;
  const change = priceChange(priceVnd, referenceVnd);
  const technical = technicalScores(input.bars, asOf);
  const events = input.events.filter(
    (e) =>
      e.event_date >= vietnamDate(Date.parse(asOf)) &&
      Date.parse(e.event_date + 'T00:00:00+07:00') <=
        Date.parse(asOf) + 31 * 86400000 &&
      Date.parse(e.known_at) <= Date.parse(asOf),
  );
  const gSafety = graham.marginOfSafety.ok ? graham.marginOfSafety.value : null;
  const bSafety = buffett.marginOfSafety.ok
    ? buffett.marginOfSafety.value
    : null;
  const safety =
    gSafety !== null && bSafety !== null
      ? round(clamp(Math.min(gSafety, bSafety) * 100))
      : null;
  const parts = {
    momentum: change === null ? null : round(clamp(50 + change * 5)),
    unusualVolume: technical.volume,
    shortTechnical: technical.short,
    mediumTechnical: technical.medium,
    quality: eligible ? 100 : null,
    graham: graham.coverage ? graham.score : null,
    buffett: buffett.coverage ? buffett.score : null,
    valuation:
      gSafety !== null || bSafety !== null
        ? round(
            clamp(
              Math.min(
                ...[gSafety, bSafety].filter((v): v is number => v !== null),
              ) * 100,
            ),
          )
        : null,
    safety,
    // Sự kiện là chất xúc tác để theo dõi, không dự đoán kết quả tích cực.
    events: events.length ? 100 : null,
  };
  const weights: Record<Horizon, [keyof typeof parts, number][]> = {
    day: [
      ['momentum', 0.35],
      ['unusualVolume', 0.25],
      ['shortTechnical', 0.25],
      ['quality', 0.15],
    ],
    month: [
      ['mediumTechnical', 0.4],
      ['valuation', 0.4],
      ['events', 0.2],
    ],
    quarter: [
      ['graham', 0.35],
      ['buffett', 0.35],
      ['safety', 0.3],
    ],
  };
  return (['day', 'month', 'quarter'] as const).map((horizon) => {
    const components = weights[horizon].map(([key, weight]) => ({
      key,
      weight,
      score: parts[key],
      availableFraction:
        key === 'valuation'
          ? Number(gSafety !== null) * 0.5 + Number(bSafety !== null) * 0.5
          : 1,
    }));
    const coverage = round(
      components.reduce(
        (s, c) => s + (c.score === null ? 0 : c.weight * c.availableFraction),
        0,
      ),
    );
    const score =
      eligible && coverage > 0
        ? round(
            components.reduce(
              (s, c) => s + (c.score ?? 0) * c.weight * c.availableFraction,
              0,
            ),
          )
        : null;
    const financialCoverage =
      horizon === 'day' ? Number(eligible) : report.coverage;
    const blockers: string[] = [];
    if (!eligible)
      blockers.push('Chưa qua bộ lọc BCTC, giá và vốn hóa tối thiểu.');
    if (!report.quoteUsable || input.referenceOnly)
      blockers.push(
        'Chưa có giá giao dịch với thời điểm nguồn và phiên đã xác minh.',
      );
    if (coverage < 1)
      blockers.push('Thiếu đầu vào cho đủ 100% trọng số của kỳ xếp hạng.');
    if (horizon !== 'day') {
      for (const strategy of report.strategies)
        for (const c of strategy.criteria)
          if (c.status === 'unknown')
            blockers.push(strategy.name + ': ' + c.label + '.');
    }
    if (horizon === 'month' && !input.eventsChecked)
      blockers.push(
        'Chưa xác nhận phạm vi lịch sự kiện; không coi thiếu lịch là không có sự kiện.',
      );
    const rankingEligibility = {
      policy: 'complete-v1',
      eligible: blockers.length === 0 && financialCoverage === 1,
      quoteVerified: report.quoteUsable && !input.referenceOnly,
      financialCoverage,
      blockers,
    };
    const reasons =
      horizon === 'day'
        ? [
            `Biến động so với giá tham chiếu: ${change ?? 'không đủ dữ liệu'}%.`,
            'Lọc EPS năm, lợi nhuận, vốn chủ dương; vốn hóa ≥100 tỷ, giá ≥1.000đ.',
          ]
        : horizon === 'month'
          ? [
              `Biên an toàn Graham (Buffett bổ sung khi đủ dữ liệu): ${gSafety === null ? 'không đủ dữ liệu' : round(gSafety * 100) + '%'}.`,
              events.length
                ? events
                    .map((e) => e.title + ' (' + e.event_date + ')')
                    .join('; ')
                : 'Chưa có sự kiện sắp tới đã xác minh.',
            ]
          : [
              `Graham ${parts.graham ?? '—'}/100; Buffett ${parts.buffett ?? '—'}/100.`,
              `Biên an toàn bảo thủ của hai mô hình: ${gSafety === null || bSafety === null ? 'không đủ dữ liệu' : round(Math.min(gSafety, bSafety) * 100) + '%'}.`,
            ];
    reasons.push(
      coverage < 1
        ? `Dữ liệu bao phủ ${round(coverage * 100)}% trọng số; tiêu chí thiếu không được phân bổ lại.`
        : 'Đủ các nhóm tiêu chí; xem độ tin cậy và giả định mô hình.',
    );
    return {
      stock_id: input.stockId,
      horizon,
      value: score,
      insufficient_reason: score === null ? 'không đủ dữ liệu' : null,
      inputs_as_of: financials?.fetchedAt ?? asOf,
      explanation: {
        modelVersion: rankingModel,
        rankingEligibility,
        referenceOnly: input.referenceOnly ?? false,
        components,
        strategies: parts,
        reasons,
        coverage,
        confidence: report.confidence,
        marketCapVnd: cap,
        changePercent: change,
        priceVnd,
        quoteFetchedAt,
        grahamMargin: gSafety,
        buffettMargin: bSafety,
        eligible,
        events,
        notices: report.risks,
      },
    };
  });
}
