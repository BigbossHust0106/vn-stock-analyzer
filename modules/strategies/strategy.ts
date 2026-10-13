import type {
  AnnualFinancials,
  FinancialData,
} from '../providers/financial-types';
import type { Result } from './result';
export interface Criterion {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'unknown';
  weight: number;
  explanation: string;
}
export interface StrategyScore {
  id: 'graham' | 'buffett';
  name: string;
  score: number;
  coverage: number;
  criteria: Criterion[];
  intrinsicVnd: Result<number>;
  marginOfSafety: Result<number>;
  valuationLabel: string;
}
export function criterion(
  id: string,
  label: string,
  weight: number,
  test: boolean | null,
  explanation: string,
): Criterion {
  return {
    id,
    label,
    weight,
    status: test === null ? 'unknown' : test ? 'pass' : 'fail',
    explanation:
      test === null ? 'Không đủ dữ liệu. ' + explanation : explanation,
  };
}
export function strategyResult(
  id: StrategyScore['id'],
  name: string,
  criteria: Criterion[],
  intrinsicVnd: Result<number>,
  marginOfSafety: Result<number>,
  valuationLabel: string,
): StrategyScore {
  const sum = criteria.reduce((s, c) => s + c.weight, 0);
  return {
    id,
    name,
    score: Math.round(
      (criteria
        .filter((c) => c.status === 'pass')
        .reduce((s, c) => s + c.weight, 0) /
        sum) *
        100,
    ),
    coverage:
      criteria
        .filter((c) => c.status !== 'unknown')
        .reduce((s, c) => s + c.weight, 0) / sum,
    criteria,
    intrinsicVnd,
    marginOfSafety,
    valuationLabel,
  };
}
export function availableAnnual(
  data: FinancialData | null,
  asOf: string,
): AnnualFinancials[] {
  if (!data?.supported || !Number.isFinite(Date.parse(asOf))) return [];
  const rows = data.annual
    .filter(
      (r) =>
        r.audited &&
        r.consolidated &&
        Date.parse(r.publishedAt) <= Date.parse(asOf) &&
        r.periodEnd < asOf.slice(0, 10),
    )
    .sort((a, b) => a.year - b.year);
  // Không chấm chuỗi khi provider đưa nhiều bản cùng năm hoặc năm tương lai.
  if (new Set(rows.map((r) => r.year)).size !== rows.length) return [];
  return rows;
}
export function consecutiveSeries(
  rows: AnnualFinancials[],
  get: (r: AnnualFinancials) => number | null,
  years = 3,
): number[] | null {
  const recent = rows.slice(-years);
  if (
    recent.length !== years ||
    !recent.every((r, i) => i === 0 || r.year === recent[i - 1]!.year + 1)
  )
    return null;
  const values = recent.map(get);
  return values.every(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
    ? values
    : null;
}
export function ratio(a: unknown, b: unknown): number | null {
  if (
    typeof a !== 'number' ||
    !Number.isFinite(a) ||
    typeof b !== 'number' ||
    !Number.isFinite(b) ||
    b <= 0
  )
    return null;
  const v = a / b;
  return Number.isFinite(v) ? v : null;
}
