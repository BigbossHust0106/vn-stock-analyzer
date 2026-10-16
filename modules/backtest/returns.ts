export type Holding = 'day' | 'month' | 'quarter';
export const holdings: Holding[] = ['day', 'month', 'quarter'];
export interface ReturnLeg {
  symbol: string;
  entryDate?: string | null;
  exitDate?: string | null;
  targetDate?: string | null;
  entry?: number | null;
  exit?: number | null;
  benchmarkEntry?: number | null;
  benchmarkExit?: number | null;
  source?: string | null;
  benchmarkSource?: string | null;
  reason?: string | null;
}
export function priceReturn(entry: unknown, exit: unknown): number | null {
  if (
    typeof entry !== 'number' ||
    typeof exit !== 'number' ||
    !Number.isFinite(entry) ||
    !Number.isFinite(exit) ||
    entry <= 0 ||
    exit <= 0
  )
    return null;
  const result = (exit / entry - 1) * 100;
  return Number.isFinite(result) ? result : null;
}
export function summarize(legs: ReturnLeg[], expected: number) {
  const observations = legs.map((leg) => ({
    ...leg,
    returnPct: leg.reason ? null : priceReturn(leg.entry, leg.exit),
    benchmarkPct: leg.reason
      ? null
      : priceReturn(leg.benchmarkEntry, leg.benchmarkExit),
  }));
  const measured = observations.filter((o) => o.returnPct !== null);
  // Equal initial weights; never renormalize away a missing/delisted member.
  const complete =
    expected > 0 && legs.length === expected && measured.length === expected;
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  const returnPct = complete ? mean(measured.map((o) => o.returnPct!)) : null;
  const benchmarkComplete =
    complete && observations.every((o) => o.benchmarkPct !== null);
  const benchmarkPct = benchmarkComplete
    ? mean(observations.map((o) => o.benchmarkPct!))
    : null;
  return {
    expected,
    measured: measured.length,
    complete,
    returnPct,
    benchmarkPct,
    excessPct:
      returnPct !== null && benchmarkPct !== null
        ? returnPct - benchmarkPct
        : null,
    winRatePct: complete
      ? (measured.filter((o) => o.returnPct! > 0).length / expected) * 100
      : null,
    observations,
  };
}
export interface Cohort {
  id: string;
  recorded_at: string;
  source_run_at: string;
  as_of: string;
  horizon: Holding;
  universe_count: number;
  eligible_count: number;
  model_version: string;
  policy: string;
  items: {
    stock_id: string;
    symbol: string;
    name: string;
    score: number;
    position: number;
    explanation: unknown;
  }[];
  legs: Record<Holding, ReturnLeg[]>;
}
export function evaluateCohort(cohort: Cohort) {
  return {
    ...cohort,
    results: Object.fromEntries(
      holdings.map((h) => [h, summarize(cohort.legs[h], cohort.items.length)]),
    ) as Record<Holding, ReturnType<typeof summarize>>,
  };
}
