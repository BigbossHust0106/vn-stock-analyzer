import { validSourceDate } from '../providers/source-evidence';
import { symbolValue } from '../providers/market-schema';
interface SessionEvidence {
  session_date: string;
  is_open: boolean;
  closes_at: string | null;
  source: string;
  verified_at: string;
}
interface EventEvidence {
  symbol: string;
  kind: 'earnings' | 'dividend' | 'agm';
  event_date: string;
  title: string;
  source_url: string;
  known_at: string;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function source(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}
function timestamp(value: unknown, now: number): value is string {
  return (
    typeof value === 'string' &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) <= now
  );
}
export function parseEvidence(
  value: unknown,
  now = Date.now(),
): { sessions: SessionEvidence[]; events: EventEvidence[] } {
  if (
    !object(value) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.events) ||
    value.sessions.length > 730 ||
    value.events.length > 5000
  )
    throw new Error(
      'Cần JSON sessions/events với giới hạn 730 phiên/5.000 sự kiện',
    );
  const sessions = value.sessions.map((row) => {
    if (
      !object(row) ||
      typeof row.session_date !== 'string' ||
      !validSourceDate(row.session_date) ||
      typeof row.is_open !== 'boolean' ||
      !source(row.source) ||
      !timestamp(row.verified_at, now)
    )
      throw new Error(
        'Lịch phiên phải có ngày hợp lệ và URL nguồn HTTPS được xác minh',
      );
    if (
      row.is_open
        ? typeof row.closes_at !== 'string' ||
          !Number.isFinite(Date.parse(row.closes_at)) ||
          !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.closes_at) ||
          !row.closes_at.startsWith(row.session_date)
        : row.closes_at !== null
    )
      throw new Error('Giờ đóng phiên không hợp lệ');
    return {
      session_date: row.session_date,
      is_open: row.is_open,
      closes_at: row.closes_at as string | null,
      source: row.source,
      verified_at: row.verified_at,
    };
  });
  const events = value.events.map((row) => {
    if (
      !object(row) ||
      typeof row.symbol !== 'string' ||
      !['earnings', 'dividend', 'agm'].includes(String(row.kind)) ||
      typeof row.event_date !== 'string' ||
      !validSourceDate(row.event_date) ||
      typeof row.title !== 'string' ||
      !row.title.trim() ||
      row.title.length > 300 ||
      !source(row.source_url) ||
      !timestamp(row.known_at, now)
    )
      throw new Error('Sự kiện phải có mã, loại/ngày và nguồn được công bố');
    return {
      symbol: symbolValue(row.symbol),
      kind: row.kind as EventEvidence['kind'],
      event_date: row.event_date,
      title: row.title,
      source_url: row.source_url,
      known_at: row.known_at,
    };
  });
  if (new Set(sessions.map((s) => s.session_date)).size !== sessions.length)
    throw new Error('Lịch phiên trùng ngày');
  return { sessions, events };
}
