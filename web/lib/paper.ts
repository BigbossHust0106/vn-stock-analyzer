import { apiBase } from './notifications';
import { settingsClient } from './scoring-settings';
import type {
  PaperWallet,
  PaperTrade,
  PaperPosition,
  portfolioValue,
} from '../../modules/paper/accounting';
export interface PaperState {
  wallets: PaperWallet[];
  wallet: PaperWallet | null;
  valuation: ReturnType<typeof portfolioValue> | null;
  trades: PaperTrade[];
  positions: PaperPosition[];
  next: { before: string; id: string } | null;
}
// Private bearer requests, no-store. Never automatically retry mutations.
export class PaperError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function paperRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const db = await settingsClient(),
    {
      data: { session },
    } = await db.auth.getSession();
  if (!session) throw new PaperError('Cần đăng nhập lại.', 401, 'AUTH');
  const response = await fetch(apiBase() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const value = (await response.json()) as { error?: unknown; code?: unknown };
  if (!response.ok)
    throw new PaperError(
      typeof value.error === 'string'
        ? value.error
        : 'Chưa xác nhận được thao tác ví thử.',
      response.status,
      typeof value.code === 'string' ? value.code : 'UNKNOWN',
    );
  return value as T;
}
