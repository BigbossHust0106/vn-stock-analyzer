import { createHash, timingSafeEqual } from 'node:crypto';
import type { Env } from '../index';
import { syncNews } from '../news/sync';
import { syncRankings } from '../ranking-sync';
/** Server-only maintenance endpoint: never called with a service key from a browser. */
export async function newsJobResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/v1/internal/news-sync') return null;
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
    candidate =
      request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (
    !key ||
    key.length < 32 ||
    candidate.length > 4096 ||
    !timingSafeEqual(
      createHash('sha256').update(candidate).digest(),
      createHash('sha256').update(key).digest(),
    )
  )
    return Response.json(
      { error: 'Không có quyền chạy tác vụ' },
      { status: 401, headers },
    );
  try {
    const timestamp = Date.now(),
      result = await syncNews(env, timestamp);
    if (!result.skipped) await syncRankings(env, Date.now());
    return Response.json({ result }, { headers });
  } catch {
    return Response.json(
      { error: 'Đồng bộ tin lỗi; kiểm tra trạng thái nguồn, không đủ dữ liệu' },
      { status: 502, headers },
    );
  }
}
