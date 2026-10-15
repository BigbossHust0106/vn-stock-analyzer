import { newsJobResponse } from './api/news-job';
import { newsResponse } from './api/news';
import { syncNews } from './news/sync';
import type { NewsConfig } from '../../modules/news/analysis';
import { rankingsResponse } from './api/rankings';
import { watchlistsResponse } from './api/watchlists';
import { tradingSync } from './trading-sync';
import { syncRankings } from './ranking-sync';
import { financialResponse } from './api/financials';
import { createClient } from '@supabase/supabase-js';
import deployment from '../../config/public-deployment.json';
import { marketResponse } from './api/market';
import type { ProviderConfig } from '../../modules/providers/registry';
import { syncMarket } from './market-sync';
import { healthResponse } from './api/health';
import { canIngest, vietnamDate } from '../../modules/market/calendar';
import {
  validatedSymbols,
  VpsProvider,
} from '../../modules/providers/vps-provider';
export interface Env extends ProviderConfig, NewsConfig {
  SYNC_SYMBOLS?: string;
  ASSETS?: Pick<WorkerBindings['ASSETS'], 'fetch'>;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export async function ingest(env: Env, timestamp: number): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL || deployment.supabaseUrl;
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Thiếu cấu hình Supabase');
  const db = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: sessionError } = await db
    .from('trading_sessions')
    .select('session_date,is_open,closes_at')
    .eq('session_date', vietnamDate(timestamp))
    .maybeSingle();
  if (sessionError) throw new Error('Không đọc được lịch giao dịch');
  if (!canIngest(session, timestamp)) return;
  const provider = new VpsProvider();
  let imported = 0;
  for (let start = 0; ; start += 1000) {
    const { data: stocks, error } = await db
      .from('stocks')
      .select('symbol')
      .eq('active', true)
      .order('symbol')
      .range(start, start + 999);
    if (error || !stocks) throw new Error('Không đọc được danh sách mã');
    for (let offset = 0; offset < stocks.length; offset += 50) {
      const quotes = await provider.fetchQuotes(
        stocks.slice(offset, offset + 50).map((s) => String(s.symbol)),
      );
      const { error: writeError } = await db.rpc('ingest_current_quotes', {
        rows: quotes.map((q) => ({
          symbol: q.symbol,
          reference_vnd: q.referenceVnd,
          ceiling_vnd: q.ceilingVnd,
          floor_vnd: q.floorVnd,
          last_price_vnd: q.lastPriceVnd,
          bid3_price_vnd: q.bid3PriceVnd,
          last_volume_raw: q.volumeRaw.lastVolume,
          lot_raw: q.volumeRaw.lot,
          fetched_at: q.fetchedAt,
        })),
      });
      if (writeError) throw new Error('Không ghi được snapshot giá hiện tại');
      imported += quotes.length;
    }
    if (stocks.length < 1000) break;
  }
  if (imported === 0) throw new Error('Danh mục chưa có mã đã xác minh');
  const completedAt = new Date().toISOString();
  const { error } = await db.from('system_status').upsert({
    component: 'prices',
    state: 'ok',
    last_success_at: completedAt,
    updated_at: completedAt,
  });
  if (error) throw new Error('Không cập nhật được trạng thái');
}
export default {
  async fetch(
    request: Request,
    env: Env = {},
    context?: Pick<ExecutionContext, 'waitUntil'>,
  ): Promise<Response> {
    const url = new URL(request.url);
    const supabaseUrl = env.SUPABASE_URL || deployment.supabaseUrl;
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    };
    const job = await newsJobResponse(request, env);
    if (job) return job;
    if (request.method !== 'GET')
      return Response.json(
        { error: 'Phương thức không được hỗ trợ' },
        { status: 405, headers: { ...headers, Allow: 'GET' } },
      );
    if (url.pathname === '/health') return healthResponse();
    if (url.pathname === '/v1/public-config') {
      // Publishable keys được phép dùng trong browser. Chặn secret/service_role
      // dù người vận hành vô tình đặt nhầm vào biến publishable.
      if (
        !/^sb_publishable_[A-Za-z0-9_-]+$/.test(
          env.SUPABASE_PUBLISHABLE_KEY ?? '',
        )
      )
        return Response.json(
          { error: 'Cấu hình công khai chưa sẵn sàng' },
          { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } },
        );
      return Response.json(
        {
          supabaseUrl,
          supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        },
        { headers: { ...headers, 'Cache-Control': 'no-store' } },
      );
    }
    const privateResponse = await watchlistsResponse(request, env);
    if (privateResponse) return privateResponse;
    const news = await newsResponse(request, env);
    if (news) return news;
    const ranking = await rankingsResponse(request, env);
    if (ranking) return ranking;
    const financial = await financialResponse(request, env, context);
    if (financial) return financial;
    const market = await marketResponse(request, env, context);
    if (market) return market;
    if (url.pathname !== '/v1/quotes')
      if (env.ASSETS && !url.pathname.startsWith('/v1/'))
        return env.ASSETS.fetch(request);
    if (url.pathname !== '/v1/quotes')
      return Response.json(
        { error: 'Không tìm thấy' },
        { status: 404, headers },
      );
    let symbols: string[];
    try {
      symbols = validatedSymbols(
        (url.searchParams.get('symbols') ?? '').split(','),
      );
    } catch {
      return Response.json(
        { error: 'Cần 1–50 mã hợp lệ, ngăn cách bằng dấu phẩy' },
        { status: 400, headers },
      );
    }
    if (!env.SUPABASE_PUBLISHABLE_KEY)
      return Response.json(
        { error: 'Nguồn dữ liệu chưa được cấu hình' },
        { status: 503, headers },
      );
    // Requests công khai chỉ dùng publishable key: không dùng service_role để đọc dữ liệu người dùng.
    try {
      const db = createClient(supabaseUrl, env.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await db
        .from('stocks')
        .select('symbol,prices_current(*)')
        .in('symbol', symbols);
      if (error) throw new Error('Read failed');
      return Response.json(
        {
          data,
          notice:
            'Snapshot có thể cũ; fetched_at không phải thời gian sàn. lot × 10 theo đối chiếu 1 mã/1 ngày; lastVolume và price basis chưa xác minh.',
          disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
        },
        { headers: { ...headers, 'Cache-Control': 'public, max-age=15' } },
      );
    } catch {
      return Response.json(
        { error: 'Không đọc được nguồn dữ liệu' },
        { status: 502, headers },
      );
    }
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: Pick<ExecutionContext, 'waitUntil'>,
  ): void {
    if (controller.cron === '*/30 * * * *') {
      context.waitUntil(
        syncNews(env, controller.scheduledTime)
          .then((result) =>
            result?.skipped
              ? undefined
              : syncRankings(env, controller.scheduledTime),
          )
          .catch(() => {
            console.error(
              'Cron tin tức thất bại; không ghi log credential hay phản hồi LLM',
            );
            throw new Error('Cron tin tức thất bại');
          }),
      );
      return;
    }
    if (
      controller.cron === '*/5 2-8 * * 1-5' ||
      controller.cron === '15 8 * * 1-5'
    ) {
      context.waitUntil(
        tradingSync(
          env,
          controller.scheduledTime,
          controller.cron === '15 8 * * 1-5',
        ).catch(() => {
          console.error('Cron giá/xếp hạng thất bại');
          throw new Error('Cron giá/xếp hạng thất bại');
        }),
      );
      return;
    }
    if (controller.cron === '0 9 * * 1-5') {
      context.waitUntil(
        syncMarket(env, controller.scheduledTime)
          .then((synced) =>
            synced ? syncRankings(env, controller.scheduledTime) : undefined,
          )
          .catch(() => {
            console.error(
              'Đồng bộ thị trường thất bại; kiểm tra cấu hình và nguồn',
            );
            throw new Error('Đồng bộ thị trường thất bại');
          }),
      );
      return;
    }
    if (controller.cron !== '30 8 * * 1-5') return;
    context.waitUntil(
      ingest(env, controller.scheduledTime).catch(() => {
        console.error(
          'Cron ingest thất bại; kiểm tra cấu hình, lịch và nguồn dữ liệu',
        );
        throw new Error('Cron ingest thất bại');
      }),
    );
  },
};
