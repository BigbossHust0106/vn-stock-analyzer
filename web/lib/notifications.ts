import { settingsClient } from './scoring-settings';
import deployment from '../../config/public-deployment.json';
export interface NotificationRow {
  id: string;
  stock_id: string;
  watchlist_id: string | null;
  kind: string;
  title: string;
  body: string;
  source_url: string | null;
  created_at: string;
  read_at: string | null;
  stocks: { symbol: string };
}
export interface NotificationFeed {
  data: NotificationRow[];
  unread: number;
  emailConfigured: boolean;
  email: {
    notification_id: string;
    state: string;
    attempts: number;
    code: string | null;
  }[];
}
export function apiBase() {
  return typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? window.location.origin
    : deployment.workerUrl;
}
export async function notificationRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const db = await settingsClient(),
    {
      data: { session },
    } = await db.auth.getSession();
  if (!session) throw Error('Cần đăng nhập lại.');
  const r = await fetch(apiBase() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : { signal: AbortSignal.timeout(15000) }),
    cache: 'no-store',
  });
  const value = (await r.json()) as { error?: unknown };
  if (!r.ok)
    throw Error(
      typeof value.error === 'string'
        ? value.error
        : 'Không tải được thông báo.',
    );
  return value as T;
}
