export function vietnamDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export interface TradingSession {
  session_date: string;
  is_open: boolean;
  closes_at: string | null;
}
export function yearsBefore(date: string, years: number): string {
  const value = new Date(date + 'T00:00:00Z');
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() - years);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}
export function canIngest(
  session: TradingSession | null,
  timestamp: number,
): boolean {
  // Không suy đoán lịch nghỉ. Thiếu lịch có nguồn xác minh → không tải.
  if (
    !session?.is_open ||
    session.session_date !== vietnamDate(timestamp) ||
    !session.closes_at
  )
    return false;
  const closed = Date.parse(session.closes_at);
  return Number.isFinite(closed) && timestamp >= closed;
}
