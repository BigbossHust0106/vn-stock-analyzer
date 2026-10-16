import type { Env } from '../index';
export async function apiRateLimit(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/')) return null;
  const headers = {
    'Cache-Control': 'no-store',
    'Retry-After': '60',
    'Access-Control-Allow-Origin': '*',
  };
  if (url.toString().length > 2048)
    return Response.json(
      { error: 'Đường dẫn quá dài.' },
      { status: 414, headers },
    );
  // Internal jobs authenticate with HMAC and must not compete with browser polling.
  if (url.pathname.startsWith('/v1/internal/')) return null;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  try {
    if (
      env.API_RATE_LIMIT &&
      !(await env.API_RATE_LIMIT.limit({ key: 'api:' + ip })).success
    )
      return Response.json(
        { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau một phút.' },
        { status: 429, headers },
      );
    if (
      env.ANALYSIS_RATE_LIMIT &&
      ['/v1/backtest', '/v1/financials', '/v1/paper'].some((p) =>
        url.pathname.startsWith(p),
      ) &&
      !(await env.ANALYSIS_RATE_LIMIT.limit({ key: 'analysis:' + ip })).success
    )
      return Response.json(
        { error: 'Đã chạm giới hạn phân tích. Thử lại sau một phút.' },
        { status: 429, headers },
      );
    return null;
  } catch {
    return Response.json(
      { error: 'Chưa kiểm tra được giới hạn truy cập; vui lòng thử lại.' },
      { status: 503, headers },
    );
  }
}
