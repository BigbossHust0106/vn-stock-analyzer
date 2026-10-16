import { quotesResponse } from './api/quotes';
import { notificationsResponse } from './api/notifications';
import { paperResponse } from './api/paper';
import { backtestResponse } from './api/backtest';
import { publicReadCache } from './api/public-cache';
import { apiRateLimit } from './api/rate-limit';
import { systemStatusResponse } from './api/system-status';
import { systemJobResponse } from './api/system-job';
import { runScheduledJobs } from './jobs/scheduled';
import type { AlertEmailConfig } from './alerts/email';
import { newsJobResponse } from './api/news-job';
import { newsResponse } from './api/news';
import type { NewsConfig } from '../../modules/news/analysis';
import { rankingsResponse } from './api/rankings';
import { watchlistsResponse } from './api/watchlists';
import { financialResponse } from './api/financials';
import { createClient } from '@supabase/supabase-js';
import deployment from '../../config/public-deployment.json';
import { marketResponse } from './api/market';
import type { ProviderConfig } from '../../modules/providers/registry';
import { healthResponse } from './api/health';
import { canIngest, vietnamDate } from '../../modules/market/calendar';
import { VpsProvider } from '../../modules/providers/vps-provider';
export interface Env extends ProviderConfig, NewsConfig, AlertEmailConfig {
  API_RATE_LIMIT?: WorkerBindings['API_RATE_LIMIT'];
  ANALYSIS_RATE_LIMIT?: WorkerBindings['ANALYSIS_RATE_LIMIT'];
  SYNC_SYMBOLS?: string;
  ASSETS?: Pick<WorkerBindings['ASSETS'], 'fetch'>;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export async function ingest(env: Env, timestamp: number) {
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
  if (!canIngest(session, timestamp))
    return session
      ? ('session_closed' as const)
      : ('calendar_missing' as const);
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
  return 'updated' as const;
}
export default {
  async fetch(
    request: Request,
    env: Env = {},
    context?: Pick<ExecutionContext, 'waitUntil'>,
  ): Promise<Response> {
    const limited = await apiRateLimit(request, env);
    if (limited) return limited;
    const response = await publicReadCache(request, context, async () => {
      const url = new URL(request.url);
      const supabaseUrl = env.SUPABASE_URL || deployment.supabaseUrl;
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      };
      const systemJob = await systemJobResponse(request, env);
      if (systemJob) return systemJob;
      const paper = await paperResponse(request, env);
      if (paper) return paper;
      const notifications = await notificationsResponse(request, env);
      if (notifications) return notifications;
      const status = await systemStatusResponse(request, env);
      if (status) return status;
      const job = await newsJobResponse(request, env);
      if (job) return job;
      if (request.method !== 'GET')
        return Response.json(
          { error: 'Phương thức không được hỗ trợ' },
          { status: 405, headers: { ...headers, Allow: 'GET' } },
        );
      if (url.pathname === '/health') return healthResponse();
      const backtest = await backtestResponse(request, env);
      if (backtest) return backtest;
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
            {
              status: 503,
              headers: { ...headers, 'Cache-Control': 'no-store' },
            },
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
      const quotes = await quotesResponse(request, env);
      if (quotes) return quotes;
      if (env.ASSETS && !url.pathname.startsWith('/v1/'))
        return env.ASSETS.fetch(request);
      return Response.json(
        { error: 'Không tìm thấy' },
        { status: 404, headers },
      );
    });
    const secured = new Response(response.body, response);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('X-Frame-Options', 'DENY');
    secured.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    secured.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    return secured;
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: Pick<ExecutionContext, 'waitUntil'>,
  ): void {
    if (
      ![
        '*/5 * * * *',
        '*/30 * * * *',
        '*/5 2-8 * * 1-5',
        '* 2-8 * * 1-5',
        '15 8 * * 1-5',
        '0 9 * * 1-5',
        '30 8 * * 1-5',
      ].includes(controller.cron)
    )
      return;
    context.waitUntil(
      runScheduledJobs(
        controller.cron,
        controller.scheduledTime,
        env,
        ingest,
      ).catch(() => {
        console.error(
          JSON.stringify({
            component: 'system-job',
            code: 'JOB_FAILED',
            cron: controller.cron,
          }),
        );
        throw new Error('Cron thất bại; xem nhật ký hệ thống.');
      }),
    );
  },
};
