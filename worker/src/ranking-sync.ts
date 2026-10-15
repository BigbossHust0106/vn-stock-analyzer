import { integrateNews } from '../../modules/news/ranking';
import { validNewsWeight } from '../../modules/news/ranking';
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
export async function rankingRows(
  db: SupabaseClient,
  timestamp: number,
  newsWeight = 0.1,
) {
  if (!validNewsWeight(newsWeight))
    throw Error('Trọng số tin tức không hợp lệ');
  const asOf = new Date(timestamp).toISOString();
  const newsByStock = new Map<string, NewsScore>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('news_scores')
      .select('stock_id,payload,updated_at')
      .gte('updated_at', new Date(timestamp - 3600000).toISOString())
      .order('stock_id')
      .range(offset, offset + 999);
    if (error || !data) throw Error('Không đọc được điểm tin tức');
    for (const n of data) newsByStock.set(n.stock_id, n.payload as NewsScore);
    if (data.length < 1000) break;
  }
  const rows: ReturnType<typeof integrateNews>[] = [];
  for (let start = 0; ; start += 200) {
    const { data: stocks, error } = await db
      .from('stocks')
      .select(
        'id,financial_snapshots(payload,version),prices_current(*),ranking_reference_prices(*)',
      )
      .eq('active', true)
      .order('id')
      .range(start, start + 199);
    if (error || !stocks) throw new Error('Không đọc được dữ liệu xếp hạng');
    for (const s of stocks) {
      const relation = <T>(v: T | T[] | null): T | null =>
        Array.isArray(v) ? (v[0] ?? null) : v;
      const financialSnapshot = relation(s.financial_snapshots);
      const f = financialSnapshot?.payload;
      if (!isFinancialData(f)) continue;
      const current = relation(s.prices_current),
        reference = relation(s.ranking_reference_prices);
      const useCurrent = !!(
        current && Date.parse(current.fetched_at) >= timestamp - 86400000
      );
      const quote =
        current && Date.parse(current.fetched_at) >= timestamp - 86400000
          ? current
          : reference
            ? {
                last_price_vnd: null,
                reference_vnd: reference.reference_vnd,
                fetched_at: reference.fetched_at,
              }
            : current;
      const [
        { data: bars, error: barError },
        { data: events, error: eventError },
      ] = await Promise.all([
        db
          .from('prices_daily')
          .select('session_date,close_vnd,volume_shares,price_basis,source')
          .eq('stock_id', s.id)
          .lte('session_date', vietnamDate(timestamp))
          .order('session_date', { ascending: false })
          .limit(220),
        db
          .from('corporate_events')
          .select('event_date,kind,title,source_url,known_at')
          .eq('stock_id', s.id)
          .gte('event_date', vietnamDate(timestamp))
          .lte('known_at', asOf),
      ]);
      if (barError || eventError)
        throw new Error('Không đọc được lịch sử/sự kiện xếp hạng');
      rows.push(
        ...rankStock({
          stockId: s.id,
          financials: f,
          priceVnd: quote?.last_price_vnd ?? quote?.reference_vnd ?? null,
          referenceOnly: quote?.last_price_vnd == null,
          referenceVnd:
            quote?.last_price_vnd == null
              ? null
              : (quote?.reference_vnd ?? null),
          quoteFetchedAt: quote?.fetched_at ?? null,
          bars: (bars ?? []) as RankingBar[],
          events: (events ?? []) as RankingEvent[],
          asOf,
        }).map((base) => ({
          ...integrateNews(
            base,
            newsByStock.get(s.id) ?? {
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
          financial_version: financialSnapshot!.version,
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
    if (stocks.length < 200) break;
  }
  if (!rows.length)
    throw new Error('Chưa có ứng viên có BCTC; không xuất bản xếp hạng rỗng');
  return rows;
}
export async function syncRankings(env: Env, timestamp = Date.now()) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu quyền cập nhật xếp hạng');
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
  if (error) throw new Error('Không xuất bản được ba bảng xếp hạng');
}
