import type { DailyBar } from '../providers/data-provider';
export type ChartFrame = 'day' | 'week' | 'month';
export function movingAverage(
  bars: readonly DailyBar[],
  period: number,
): { time: string; value: number }[] {
  if (!Number.isInteger(period) || period < 1)
    throw new Error('Chu kỳ MA không hợp lệ');
  let sum = 0;
  const result: { time: string; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const close = bars[i]!.closeVnd;
    if (!Number.isFinite(close) || close <= 0)
      throw new Error('MA thiếu dữ liệu giá');
    sum += close;
    if (i >= period) sum -= bars[i - period]!.closeVnd;
    if (!Number.isFinite(sum)) throw new Error('MA tràn số');
    if (i >= period - 1)
      result.push({ time: bars[i]!.sessionDate, value: sum / period });
  }
  return result;
}
export function aggregateBars(
  bars: readonly DailyBar[],
  frame: ChartFrame,
): DailyBar[] {
  const groups = new Map<string, DailyBar>();
  for (const bar of bars) {
    let key = bar.sessionDate;
    if (frame === 'month') key = key.slice(0, 7) + '-01';
    if (frame === 'week') {
      const date = new Date(key + 'T00:00:00Z');
      const day = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - day);
      key = date.toISOString().slice(0, 10);
    }
    const prev = groups.get(key);
    if (!prev) groups.set(key, { ...bar, sessionDate: key });
    else {
      if (
        prev.source !== bar.source ||
        prev.symbol !== bar.symbol ||
        prev.priceBasis !== bar.priceBasis
      )
        throw new Error('Không gộp nguồn hoặc mã khác nhau');
      prev.highVnd = Math.max(prev.highVnd, bar.highVnd);
      prev.lowVnd = Math.min(prev.lowVnd, bar.lowVnd);
      prev.closeVnd = bar.closeVnd;
      prev.volumeReported += bar.volumeReported;
      prev.isFinal &&= bar.isFinal;
      if (!Number.isSafeInteger(prev.volumeReported))
        throw new Error('Volume tràn số');
    }
  }
  return [...groups.values()];
}
export function changePercent(
  last: number | null,
  reference: number,
): number | null {
  const result =
    last !== null &&
    Number.isFinite(last) &&
    last > 0 &&
    Number.isFinite(reference) &&
    reference > 0
      ? (last / reference - 1) * 100
      : null;
  return result !== null && Number.isFinite(result) ? result : null;
}
