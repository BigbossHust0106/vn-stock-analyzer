import { integrateNews, validNewsWeight } from '../../modules/news/ranking';
import type { NewsScore } from '../../modules/news/sentiment';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import deployment from '../../config/public-deployment.json';
import { isFinancialData } from '../../modules/providers/financial-types';
import {
  rankStock,
  type RankingBar,
  type RankingEvent,
} from '../../modules/scoring/rankings';
import { vietnamDate } from '../../modules/market/calendar';
interface RankingBatch {
  stock_id: string;
  financial_payload: unknown;
  financial_version: string;
  current_quote: {
    last_price_vnd: number | null;
    reference_vnd: number | null;
    fetched_at: string;
    version: string;
  } | null;
  reference_quote: { reference_vnd: number; fetched_at: string } | null;
  bars: RankingBar[];
  events: RankingEvent[];
  news_payload: NewsScore | null;
}
export async function rankingRows(
  db: SupabaseClient,
  timestamp: number,
  newsWeight = 0.1,
) {
  if (!validNewsWeight(newsWeight))
    throw Error('Trọng số tin tức không hợp lệ');
  const asOf = new Date(timestamp).toISOString(),
    rows: ReturnType<typeof integrateNews>[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.rpc('ranking_batch_inputs', {
      stamp: asOf,
      offset_rows: offset,
      batch_size: 100,
    });
    if (error || !Array.isArray(data))
      throw Error('Không đọc được lô đầu vào xếp hạng');
    for (const s of data as RankingBatch[]) {
      const f = s.financial_payload;
      if (!isFinancialData(f)) continue;
      const current = s.current_quote,
        reference = s.reference_quote;
      const useCurrent = Boolean(
        current && Date.parse(current.fetched_at) >= timestamp - 86400000,
      );
      const quote = useCurrent
        ? current
        : reference
          ? {
              last_price_vnd: null,
              reference_vnd: reference.reference_vnd,
              fetched_at: reference.fetched_at,
            }
          : current;
      rows.push(
        ...rankStock({
          stockId: s.stock_id,
          financials: f,
          priceVnd: quote?.last_price_vnd ?? quote?.reference_vnd ?? null,
          referenceOnly: quote?.last_price_vnd == null,
          referenceVnd:
            quote?.last_price_vnd == null ? null : quote.reference_vnd,
          quoteFetchedAt: quote?.fetched_at ?? null,
          bars: s.bars,
          events: s.events,
          asOf,
        }).map((base) => ({
          ...integrateNews(
            base,
            s.news_payload ?? {
              score: null,
              count: 0,
              sourceCount: 0,
              asOf,
              newestAt: null,
              links: [],
              reason: 'không đủ dữ liệu',
            },
            newsWeight,
          ),
          financial_version: s.financial_version,
          quote_version:
            useCurrent || !reference ? (current?.version ?? null) : null,
          financial_inputs: f,
          quote_inputs: {
            source: useCurrent || !reference ? 'VPS' : 'KBS reference',
            raw: useCurrent || !reference ? current : reference,
            sourceTimestamp: null,
            sessionVerification: 'unverified',
          },
        })),
      );
    }
    if (data.length < 100) break;
  }
  if (!rows.length)
    throw Error('Chưa có ứng viên có BCTC; không xuất bản xếp hạng rỗng');
  return rows;
}
export async function syncRankings(env: Env, timestamp = Date.now()) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw Error('Thiếu quyền cập nhật xếp hạng');
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const rows = await rankingRows(db, timestamp, Number(env.NEWS_WEIGHT ?? 0.1));
  const { error } = await db.rpc('publish_rankings', {
    day: vietnamDate(timestamp),
    stamp: new Date(timestamp).toISOString(),
    rows,
  });
  if (error) throw Error('Không xuất bản được ba bảng xếp hạng');
}
