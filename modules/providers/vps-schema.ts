import { VPS_LOT_SIZE } from './vps-config';
// Kiểu quan sát trong fixture thật do người dùng cung cấp, không phải spec VPS chính thức.
export const vpsFieldTypes = {
  id: 'number',
  boardId: 'string',
  marketId: 'string',
  sequence: 'number',
  channel: 'null',
  sourceMsgType: 'string',
  hashValue: 'string',
  transId: 'string',
  tradingSession: 'null',
  c: 'number',
  f: 'number',
  r: 'number',
  sym: 'string',
  symCode: 'string',
  mc: 'string',
  lastPrice: 'number',
  lastVolume: 'number',
  lot: 'number',
  ot: 'string',
  changePc: 'string',
  avePrice: 'string',
  highPrice: 'string',
  lowPrice: 'string',
  g1: 'string',
  g2: 'string',
  g3: 'string',
  g4: 'string',
  g5: 'string',
  g6: 'string',
  g7: 'string',
  mp: 'null',
  lv: 'number',
  matureDate: 'string',
  mkStatus: 'string',
  closePrice: 'string',
  ptVol: 'string',
  oi: 'string',
  oichange: 'string',
  openPrice: 'string',
  side: 'string',
  productId: 'string',
  rightInfos: 'null',
  fBVol: 'string',
  fBValue: 'string',
  fSVolume: 'string',
  fSValue: 'string',
  fRoom: 'string',
  CWUnderlying: 'string',
  CWIssuerName: 'string',
  CWType: 'string',
  CWMaturityDate: 'string',
  CWLastTradingDate: 'string',
  CWExcersisePrice: 'string',
  CWExerciseRatio: 'string',
  CWListedShare: 'string',
  sType: 'string',
  sBenefit: 'string',
} as const;
export type VpsRawQuote = {
  [K in keyof typeof vpsFieldTypes]: (typeof vpsFieldTypes)[K] extends 'number'
    ? number
    : (typeof vpsFieldTypes)[K] extends 'string'
      ? string
      : null;
};
export type VpsResponse = VpsRawQuote[];

export class VpsValidationError extends Error {
  constructor(
    public readonly field: string,
    detail: string,
  ) {
    super(`VPS ${field}: ${detail}`);
    this.name = 'VpsValidationError';
  }
}
function fail(path: string, detail: string): never {
  throw new VpsValidationError(path, detail);
}
export function numericString(
  value: string,
  path: string,
  allowNegative = false,
): number {
  if (!/^[+-]?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?$/.test(value))
    fail(path, 'cần chuỗi số, không rỗng/không dấu phân cách');
  const n = Number(value);
  if (!Number.isFinite(n) || (!allowNegative && n < 0))
    fail(path, 'số không hữu hạn hoặc âm');
  return n;
}
export function parseBookLevel(
  value: string,
  path: string,
): { priceVnd: number | null; volumeRaw: number; markerRaw: string } {
  const parts = value.split('|');
  if (parts.length !== 3 || !parts[2]) fail(path, 'cần price|volume|marker');
  const price = numericString(parts[0]!, path),
    volumeRaw = numericString(parts[1]!, path);
  if (!Number.isSafeInteger(volumeRaw))
    fail(path, 'khối lượng raw phải là số nguyên an toàn');
  if (!Number.isFinite(price * 1000)) fail(path, 'giá tràn số');
  return {
    priceVnd: price === 0 ? null : price * 1000,
    volumeRaw,
    markerRaw: parts[2]!,
  };
}
export function validateVpsResponse(payload: unknown): VpsResponse {
  if (!Array.isArray(payload) || payload.length === 0)
    fail('$', 'cần mảng không rỗng');
  const seen = new Set<string>();
  return payload.map((raw: unknown, index) => {
    const base = `$[${index}]`;
    if (typeof raw !== 'object' || !raw || Array.isArray(raw))
      fail(base, 'cần object');
    const row = raw as Record<string, unknown>;
    for (const [field, type] of Object.entries(vpsFieldTypes)) {
      const path = `${base}.${field}`;
      if (!Object.hasOwn(row, field)) fail(path, 'thiếu trường bắt buộc');
      if (type === 'null' ? row[field] !== null : typeof row[field] !== type)
        fail(path, `cần ${type}`);
      if (type === 'number' && !Number.isFinite(row[field]))
        fail(path, 'cần số hữu hạn');
    }
    const typed = row as VpsRawQuote;
    if (!/^[A-Z0-9]{3,12}$/.test(typed.sym) || seen.has(typed.sym))
      fail(`${base}.sym`, 'mã không hợp lệ hoặc trùng');
    seen.add(typed.sym);
    for (const field of ['id', 'sequence', 'lastVolume', 'lot'] as const)
      if (!Number.isSafeInteger(typed[field]) || typed[field] < 0)
        fail(`${base}.${field}`, 'cần số nguyên không âm an toàn');
    if (!Number.isSafeInteger(typed.lot * VPS_LOT_SIZE))
      fail(`${base}.lot`, 'chuẩn hóa tổng khối lượng tràn số nguyên an toàn');
    for (const field of ['c', 'f', 'r'] as const)
      if (typed[field] <= 0 || !Number.isFinite(typed[field] * 1000))
        fail(`${base}.${field}`, 'cần giá dương, không tràn số');
    if (typed.f > typed.r || typed.r > typed.c)
      fail(base, 'yêu cầu f <= r <= c');
    if (typed.lastPrice < 0 || !Number.isFinite(typed.lastPrice * 1000))
      fail(`${base}.lastPrice`, 'giá không hợp lệ');
    for (const field of [
      'ot',
      'changePc',
      'avePrice',
      'highPrice',
      'lowPrice',
      'closePrice',
      'ptVol',
      'oi',
      'oichange',
      'openPrice',
      'fBVol',
      'fBValue',
      'fSVolume',
      'fSValue',
      'fRoom',
    ] as const)
      numericString(
        typed[field],
        `${base}.${field}`,
        ['fRoom', 'ot', 'changePc', 'oichange'].includes(field),
      );
    for (const field of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'] as const)
      parseBookLevel(typed[field], `${base}.${field}`);
    return typed;
  });
}
