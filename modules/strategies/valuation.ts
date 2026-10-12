import { finiteResult, insufficient, positive, type Result } from './result';

// EPS năm/TTM và BVPS đều VND/cổ phiếu; hệ số 22.5 = PE 15 × PB 1.5.
export function grahamNumber(
  epsAnnualVnd?: number | null,
  bvpsVnd?: number | null,
): Result<number> {
  if (!positive(epsAnnualVnd) || !positive(bvpsVnd)) return insufficient();
  return finiteResult(Math.sqrt(22.5 * epsAnnualVnd * bvpsVnd));
}

// DCF vốn chủ: FCFE tương lai VND, discount rate vốn chủ; terminal growth < rate.
export function dcf(
  cashFlowsVnd: readonly number[] | null,
  discountRate: number,
  terminalGrowth: number,
  shares: number,
): Result<number> {
  if (
    !cashFlowsVnd?.length ||
    !cashFlowsVnd.every(positive) ||
    !positive(discountRate) ||
    !positive(shares) ||
    !Number.isFinite(terminalGrowth) ||
    terminalGrowth <= -1 ||
    terminalGrowth >= discountRate
  )
    return insufficient();
  const last = cashFlowsVnd.at(-1)!;
  const present = cashFlowsVnd.reduce(
    (sum, cf, i) => sum + cf / (1 + discountRate) ** (i + 1),
    0,
  );
  const terminal =
    (last * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  return finiteResult(
    (present + terminal / (1 + discountRate) ** cashFlowsVnd.length) / shares,
  );
}
