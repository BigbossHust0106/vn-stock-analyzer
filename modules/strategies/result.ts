export type Result<T> =
  { ok: true; value: T } | { ok: false; reason: 'không đủ dữ liệu' };
export const insufficient = (): Result<never> => ({
  ok: false,
  reason: 'không đủ dữ liệu',
});
export function finiteResult<T extends number>(value: T): Result<T> {
  return Number.isFinite(value) ? { ok: true, value } : insufficient();
}
export const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
