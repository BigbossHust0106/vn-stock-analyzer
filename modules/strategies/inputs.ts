import { positive, insufficient, type Result } from './result';
import { grahamNumber } from './valuation';

export interface FinancialSnapshot {
  eps: number | null;
  bvps: number | null;
  epsBasis: 'annual' | 'ttm' | 'quarter';
  currencyUnit: 'VND' | 'thousand_VND';
}
export function grahamFromFinancials(
  input: FinancialSnapshot | null,
): Result<number> {
  // Không nhân EPS quý ×4. Chỉ chấp nhận EPS năm/TTM từ nguồn xác minh.
  if (
    !input ||
    !['annual', 'ttm'].includes(input.epsBasis) ||
    !['VND', 'thousand_VND'].includes(input.currencyUnit) ||
    !positive(input.eps) ||
    !positive(input.bvps)
  )
    return insufficient();
  const scale = input.currencyUnit === 'VND' ? 1 : 1000;
  return grahamNumber(input.eps * scale, input.bvps * scale);
}
export interface ClosingPoint {
  closeVnd: number;
  priceBasis: 'adjusted' | 'unadjusted' | 'unverified';
}
export function closingSeries(
  points: readonly (ClosingPoint | null)[] | null,
): Result<number[]> {
  if (
    !points?.length ||
    !points[0] ||
    !['adjusted', 'unadjusted'].includes(points[0].priceBasis) ||
    !points.every(
      (p): p is ClosingPoint =>
        p !== null &&
        positive(p.closeVnd) &&
        p.priceBasis === points[0]!.priceBasis,
    )
  )
    return insufficient();
  return { ok: true, value: points.map((p) => p.closeVnd) };
}
