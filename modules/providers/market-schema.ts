import type { DailyBar, StockInfo, Exchange } from './data-provider';
import { vietnamDate } from '../market/calendar';
import { validSourceDate } from './source-evidence';

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function symbolValue(symbol: string): string {
  if (!/^[A-Z0-9]{3,12}$/.test(symbol))
    throw new Error('Mã chứng khoán không hợp lệ');
  return symbol;
}
export function historyRange(from: string, to: string): void {
  if (
    !validSourceDate(from) ||
    !validSourceDate(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 6 * 366 * 86400000
  )
    throw new Error('Khoảng ngày lịch sử không hợp lệ (tối đa 6 năm)');
}
function exchange(value: unknown): Exchange {
  if (value !== 'HOSE' && value !== 'HNX' && value !== 'UPCOM')
    throw new Error('Sàn không được hỗ trợ');
  return value;
}
export function parseVpsProfile(
  payload: unknown,
  symbol: string,
  fetchedAt: string,
): StockInfo {
  if (
    !record(payload) ||
    payload.symbol !== symbol ||
    payload.type !== 'stock' ||
    typeof payload.description !== 'string' ||
    !payload.description.trim()
  )
    throw new Error('VPS metadata thiếu trường hoặc sai mã/loại tài sản');
  return {
    symbol: symbolValue(symbol),
    name: payload.description.trim(),
    exchange: exchange(payload['exchange-listed']),
    source: 'VPS',
    fetchedAt,
  };
}
export function parseKbsStocks(
  payload: unknown,
  fetchedAt: string,
): StockInfo[] {
  if (!Array.isArray(payload) || !payload.length)
    throw new Error('KBS danh mục không hợp lệ');
  const seen = new Set<string>();
  return payload
    .filter(
      (row: unknown) =>
        record(row) &&
        row.type === 'stock' &&
        ['HOSE', 'HNX', 'UPCOM'].includes(String(row.exchange)),
    )
    .map((row: unknown) => {
      if (
        !record(row) ||
        typeof row.symbol !== 'string' ||
        typeof row.name !== 'string' ||
        !row.name.trim()
      )
        throw new Error('KBS thiếu trường mã/tên');
      const symbol = symbolValue(row.symbol);
      if (seen.has(symbol)) throw new Error('KBS trùng mã');
      seen.add(symbol);
      return {
        symbol,
        name: row.name.trim(),
        exchange: exchange(row.exchange),
        source: 'KBS' as const,
        fetchedAt,
      };
    });
}
export function parseVpsHistory(
  payload: unknown,
  symbol: string,
  fetchedAt: string,
): DailyBar[] {
  if (!record(payload) || payload.symbol !== symbol)
    throw new Error('VPS history sai mã hoặc thiếu trường');
  if (payload.s === 'no_data') return [];
  if (
    payload.s !== 'ok' ||
    !Array.isArray(payload.t) ||
    !['o', 'h', 'l', 'c', 'v'].every(
      (key) =>
        Array.isArray(payload[key]) &&
        payload[key].length === (payload.t as unknown[]).length,
    )
  )
    throw new Error('VPS history thiếu mảng hoặc lệch chiều dài');
  const seen = new Set<string>();
  return payload.t
    .map((stamp: unknown, i) => {
      if (
        typeof stamp !== 'number' ||
        !Number.isSafeInteger(stamp) ||
        stamp < 0 ||
        !Number.isFinite(new Date(stamp * 1000).getTime())
      )
        throw new Error('VPS history timestamp không hợp lệ');
      const sessionDate = vietnamDate(stamp * 1000);
      if (seen.has(sessionDate)) throw new Error('VPS history trùng phiên');
      seen.add(sessionDate);
      const values = ['o', 'h', 'l', 'c'].map((key) => {
        const value = (payload[key] as unknown[])[i];
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value <= 0 ||
          !Number.isFinite(value * 1000)
        )
          throw new Error('VPS history giá không hợp lệ');
        return value * 1000;
      });
      const [openVnd, highVnd, lowVnd, closeVnd] = values as [
        number,
        number,
        number,
        number,
      ];
      const volumeReported = (payload.v as unknown[])[i];
      if (
        highVnd < Math.max(openVnd, closeVnd, lowVnd) ||
        lowVnd > Math.min(openVnd, closeVnd) ||
        typeof volumeReported !== 'number' ||
        !Number.isSafeInteger(volumeReported) ||
        volumeReported < 0
      )
        throw new Error('VPS history OHLC/volume không hợp lệ');
      if (sessionDate > vietnamDate(Date.parse(fetchedAt)))
        throw new Error('VPS history có phiên tương lai');
      return {
        symbol,
        sessionDate,
        openVnd,
        highVnd,
        lowVnd,
        closeVnd,
        volumeReported,
        volumeUnit: 'shares' as const,
        priceBasis: 'unverified' as const,
        source: 'VPS' as const,
        fetchedAt,
        isFinal: false,
        finality: 'unverified' as const,
      };
    })
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}
