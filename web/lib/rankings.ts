import type { NewsScore } from '../../modules/news/sentiment';
import deployment from '../../config/public-deployment.json';
export const horizonLabels = {
  day: 'Trong ngày',
  month: 'Trong tháng',
  quarter: 'Trong quý',
};
export interface RankingExplanation {
  newsIntegration?: { news: NewsScore };
  rankingEligibility?: {
    eligible: boolean;
    policy: string;
    blockers: string[];
  };
  coverage: number;
  confidence: number;
  quoteSource?: string;
  strategies: Record<string, number | null>;
  reasons: string[];
  notices: string[];
  marketCapVnd: number | null;
}
export interface RankingRow {
  stock_id: string;
  symbol: string;
  name: string;
  exchange: string;
  sector: string | null;
  position: number | null;
  as_of: string;
  computed_at: string;
  score: number | null;
  explanation: RankingExplanation;
  price_vnd: number | null;
  reference_vnd: number | null;
  quote_fetched_at: string | null;
}
export interface RankingsResult {
  data: RankingRow[];
  excluded?: RankingRow[];
  qualityPolicy?: string;
  run: { as_of: string; computed_at: string; universe_count: number } | null;
  sectors: string[];
}
export async function fetchRankings(
  horizon: string,
  exchange: string,
  sector: string,
  cap: string,
  signal: AbortSignal,
  newsWeight = 0.1,
): Promise<RankingsResult> {
  const url = new URL(
    '/v1/rankings',
    process.env.NEXT_PUBLIC_WORKER_URL ||
      (typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? window.location.origin
        : deployment.workerUrl),
  );
  url.searchParams.set('horizon', horizon);
  url.searchParams.set('newsWeight', String(newsWeight));
  if (exchange) url.searchParams.set('exchange', exchange);
  if (sector) url.searchParams.set('sector', sector);
  if (cap === 'small') {
    url.searchParams.set('maxCap', '1000000000000');
  }
  if (cap === 'mid') {
    url.searchParams.set('minCap', '1000000000000');
    url.searchParams.set('maxCap', '10000000000000');
  }
  if (cap === 'large') {
    url.searchParams.set('minCap', '10000000000000');
  }
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok)
    throw new Error('Chưa tải được bảng xếp hạng. Hãy thử lại.');
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('data' in result) ||
    !Array.isArray(result.data)
  )
    throw new Error('Dữ liệu xếp hạng không hợp lệ.');
  const validated = result as RankingsResult;
  // Defensive UI boundary: an older/misconfigured API cannot render 23 ranked rows.
  const seen = new Set<string>();
  return {
    ...validated,
    data: validated.data
      .filter((row) => {
        if (seen.has(row.stock_id) || seen.has(row.symbol)) return false;
        seen.add(row.stock_id);
        seen.add(row.symbol);
        return true;
      })
      .slice(0, 10)
      .map((row, i) => ({ ...row, position: i + 1 })),
  };
}
export function formatNumber(value: number | null | undefined, digits = 0) {
  return value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('vi-VN', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
}
export function formatTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'chưa có dữ liệu';
}
