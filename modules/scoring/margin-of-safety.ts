import {
  finiteResult,
  insufficient,
  positive,
  type Result,
} from '../strategies/result';

// Fraction, không phải phần trăm; âm khi thị giá > giá trị nội tại.
export function marginOfSafety(
  intrinsicVnd?: number | null,
  marketVnd?: number | null,
): Result<number> {
  if (!positive(intrinsicVnd) || !positive(marketVnd)) return insufficient();
  return finiteResult(1 - marketVnd / intrinsicVnd);
}
