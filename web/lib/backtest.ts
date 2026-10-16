import deployment from '../../config/public-deployment.json';
import type {
  evaluateCohort,
  Holding,
  ReturnLeg,
} from '../../modules/backtest/returns';
export interface BacktestResult {
  data: ReturnType<typeof evaluateCohort>[];
  next: { before: string; id: string } | null;
  asOf: string;
}
export interface PriceCheck {
  symbol: string;
  source: string;
  notice: string;
  legs: Record<Holding, ReturnLeg & { returnPct: number | null }>;
}
export async function fetchBacktest<T>(
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<T> {
  const base =
    process.env.NEXT_PUBLIC_WORKER_URL ||
    (typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(location.hostname)
      ? location.origin
      : deployment.workerUrl);
  const r = await fetch(new URL('/v1/backtest?' + query.toString(), base), {
    ...(signal ? { signal } : {}),
  });
  if (!r.ok)
    throw Error(
      r.status === 429
        ? 'Đã chạm giới hạn truy cập. Thử lại sau một phút.'
        : 'Chưa đọc được backtest. Thử lại hoặc xem Trạng thái hệ thống.',
    );
  return r.json() as Promise<T>;
}
