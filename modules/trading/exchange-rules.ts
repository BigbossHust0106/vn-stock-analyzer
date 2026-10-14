import type { Exchange } from '../providers/data-provider';
import { positive } from '../strategies/result';
export const normalBand = { HOSE: 0.07, HNX: 0.1, UPCOM: 0.15 } as const;
export function tickSize(price: number, exchange: Exchange) {
  return exchange === 'HOSE'
    ? price < 10000
      ? 10
      : price < 50000
        ? 50
        : 100
    : 100;
}
export function roundPrice(
  price: number,
  exchange: Exchange,
  direction: 'up' | 'down',
): number | null {
  if (!positive(price) || price > 1e12) return null;
  const tick = tickSize(price, exchange);
  const result =
    (direction === 'up'
      ? Math.ceil(price / tick - 1e-10)
      : Math.floor(price / tick + 1e-10)) * tick;
  return positive(result) ? result : null;
}
export function sessionBand(
  exchange: Exchange,
  reference: number | null,
  floor?: number | null,
  ceiling?: number | null,
) {
  if (
    positive(floor) &&
    positive(ceiling) &&
    floor <= ceiling &&
    (!positive(reference) || (floor <= reference && reference <= ceiling))
  )
    return {
      floor,
      ceiling,
      source: 'Trần/sàn từ quote nguồn; chưa xác minh timestamp phiên.',
    };
  if (!positive(reference)) return null;
  const low = roundPrice(
    reference * (1 - normalBand[exchange]),
    exchange,
    'up',
  );
  const high = roundPrice(
    reference * (1 + normalBand[exchange]),
    exchange,
    'down',
  );
  if (low === null || high === null || low >= reference || high <= reference)
    return null;
  return {
    floor: low,
    ceiling: high,
    source: `Ước tính phiên thông thường ±${normalBand[exchange] * 100}%; không áp dụng ngày giao dịch đặc biệt.`,
  };
}
export function bandState(price: number, band: ReturnType<typeof sessionBand>) {
  return !band
    ? 'Chưa có biên độ phiên'
    : price < band.floor
      ? 'Dưới sàn phiên'
      : price > band.ceiling
        ? 'Trên trần phiên'
        : 'Trong biên độ phiên';
}
