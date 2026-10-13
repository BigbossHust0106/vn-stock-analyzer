import { vietnamDate } from '../market/calendar';

// Chỉ phục vụ khảo sát/đối soát. Không chứng nhận price basis hoặc cho phép ingest production.
export interface DailyBarEvidence {
  source: 'KBS' | 'VIETCAP';
  symbol: string;
  sessionDate: string;
  openVnd: number;
  highVnd: number;
  lowVnd: number;
  closeVnd: number;
  volumeReported: number;
  priceBasis: 'unverified';
  volumeDefinition: 'unverified';
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function validSourceDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
}
function price(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`Giá nguồn ${field} không hợp lệ`);
  return value;
}
function volume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Khối lượng nguồn không hợp lệ');
  return value;
}
function bar(
  source: DailyBarEvidence['source'],
  symbol: string,
  sessionDate: string,
  raw: Record<string, unknown>,
): DailyBarEvidence {
  if (!validSourceDate(sessionDate)) throw new Error('Ngày bar không hợp lệ');
  const value = {
    source,
    symbol,
    sessionDate,
    openVnd: price(raw.o, 'open'),
    highVnd: price(raw.h, 'high'),
    lowVnd: price(raw.l, 'low'),
    closeVnd: price(raw.c, 'close'),
    volumeReported: volume(raw.v),
    priceBasis: 'unverified',
    volumeDefinition: 'unverified',
  } as const;
  if (
    value.highVnd < Math.max(value.openVnd, value.closeVnd, value.lowVnd) ||
    value.lowVnd > Math.min(value.openVnd, value.closeVnd)
  )
    throw new Error('OHLC nguồn không hợp lệ');
  return value;
}
export function parseKbsDailyEvidence(
  payload: unknown,
  symbol: string,
): DailyBarEvidence[] {
  if (
    !record(payload) ||
    payload.symbol !== symbol ||
    !Array.isArray(payload.data_day) ||
    !payload.data_day.length
  )
    throw new Error('KBS thiếu dữ liệu hoặc sai mã');
  const seen = new Set<string>();
  return payload.data_day.map((row: unknown) => {
    if (
      !record(row) ||
      typeof row.t !== 'string' ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(row.t)
    )
      throw new Error('KBS thiếu ngày bar');
    const value = bar('KBS', symbol, row.t.slice(0, 10), row);
    if (seen.has(value.sessionDate)) throw new Error('KBS trùng ngày');
    seen.add(value.sessionDate);
    return value;
  });
}
export function parseVietcapDailyEvidence(
  payload: unknown,
  symbol: string,
): DailyBarEvidence[] {
  if (!Array.isArray(payload))
    throw new Error('Vietcap không trả mảng dữ liệu');
  const matches = payload.filter(
    (row: unknown) => record(row) && row.symbol === symbol,
  );
  if (matches.length !== 1 || !record(matches[0]))
    throw new Error('Vietcap thiếu/trùng mã');
  const row = matches[0];
  const timestamps = row.t;
  if (
    !Array.isArray(timestamps) ||
    !timestamps.length ||
    !['o', 'h', 'l', 'c', 'v'].every(
      (key) => Array.isArray(row[key]) && row[key].length === timestamps.length,
    )
  )
    throw new Error('Vietcap các mảng giá/khối lượng lệch chiều dài');
  const seen = new Set<string>();
  return timestamps.map((stamp: unknown, index) => {
    if (
      typeof stamp !== 'string' ||
      !/^\d+$/.test(stamp) ||
      !Number.isSafeInteger(Number(stamp)) ||
      !Number.isFinite(new Date(Number(stamp) * 1000).getTime())
    )
      throw new Error('Vietcap timestamp không hợp lệ');
    const sessionDate = vietnamDate(Number(stamp) * 1000);
    const raw = Object.fromEntries(
      ['o', 'h', 'l', 'c', 'v'].map((key) => [
        key,
        (row[key] as unknown[])[index],
      ]),
    );
    const value = bar('VIETCAP', symbol, sessionDate, raw);
    if (seen.has(sessionDate)) throw new Error('Vietcap trùng ngày');
    seen.add(sessionDate);
    return value;
  });
}
export function compareDailyEvidence(
  a: DailyBarEvidence,
  b: DailyBarEvidence,
): { pricesMatch: boolean; volumeMatch: boolean; volumeDifference: number } {
  if (a.symbol !== b.symbol || a.sessionDate !== b.sessionDate)
    throw new Error('Không đối chiếu khác mã/ngày');
  return {
    pricesMatch:
      a.openVnd === b.openVnd &&
      a.highVnd === b.highVnd &&
      a.lowVnd === b.lowVnd &&
      a.closeVnd === b.closeVnd,
    volumeMatch: a.volumeReported === b.volumeReported,
    volumeDifference: b.volumeReported - a.volumeReported,
  };
}
