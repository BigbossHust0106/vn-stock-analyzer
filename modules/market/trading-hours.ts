import { vietnamDate, type TradingSession } from './calendar';
import type { Exchange } from '../providers/data-provider';
export function inTradingHours(
  session: TradingSession | null,
  timestamp: number,
  exchange: Exchange,
): boolean {
  if (
    !session?.is_open ||
    session.session_date !== vietnamDate(timestamp) ||
    !session.closes_at ||
    !['HOSE', 'HNX', 'UPCOM'].includes(exchange)
  )
    return false;
  const date = new Date(timestamp + 7 * 3600000),
    minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  // Bao gồm phiên thỏa thuận sau ATC HOSE/HNX; cả ba sàn dừng lúc 15:00.
  return (
    timestamp <= Date.parse(session.closes_at) &&
    ((minute >= 540 && minute <= 690) || (minute >= 780 && minute <= 900))
  );
}
