import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../index';
import { syncNews } from '../news/sync';
import { syncRankings } from '../ranking-sync';
/** Short-lived HMAC proof: the service key itself never travels to/logs at this endpoint. */
export async function newsJobResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const path = '/v1/internal/news-sync';
  if (new URL(request.url).pathname !== path) return null;
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method !== 'POST')
    return Response.json(
      { error: 'Chỉ hỗ trợ POST' },
      { status: 405, headers: { ...headers, Allow: 'POST' } },
    );
  const key = env.SUPABASE_SERVICE_ROLE_KEY,
    stamp = request.headers.get('X-News-Timestamp') ?? '',
    signature = request.headers.get('X-News-Signature') ?? '';
  if (
    !key ||
    key.length < 32 ||
    !/^\d{13}$/.test(stamp) ||
    Math.abs(Date.now() - Number(stamp)) > 60000 ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature, 'hex'),
      createHmac('sha256', key)
        .update(stamp + ':POST:' + path)
        .digest(),
    )
  )
    return Response.json(
      { error: 'Không có quyền chạy tác vụ' },
      { status: 401, headers },
    );
  let stage = 'rss';
  try {
    const result = await syncNews(env, Date.now());
    stage = 'rankings';
    if (!result.skipped) await syncRankings(env, Date.now());
    return Response.json({ result }, { headers });
  } catch {
    console.error(
      JSON.stringify({
        component: 'news-job',
        stage,
        code: 'NEWS_SYNC_FAILED',
      }),
    );
    return Response.json(
      {
        error: 'Đồng bộ tin lỗi; kiểm tra trạng thái nguồn, không đủ dữ liệu',
        stage,
      },
      { status: 502, headers },
    );
  }
}
