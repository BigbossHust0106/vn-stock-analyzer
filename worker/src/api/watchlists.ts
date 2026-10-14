import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
export async function watchlistsResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/watchlists') return null;
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const token = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token)
    return Response.json({ error: 'Cần đăng nhập' }, { status: 401, headers });
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json(
      { error: 'Chưa cấu hình đăng nhập' },
      { status: 503, headers },
    );
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + token } },
    },
  );
  try {
    const { data: user, error: authError } = await db.auth.getUser(token);
    if (authError || !user.user)
      return Response.json(
        { error: 'Phiên đăng nhập không hợp lệ' },
        { status: 401, headers },
      );
    const { data, error } = await db
      .from('watchlists')
      .select('id,name,created_at')
      .order('created_at');
    if (error) throw new Error('Read failed');
    return Response.json({ data }, { headers });
  } catch {
    return Response.json(
      { error: 'Không đọc được danh sách theo dõi' },
      { status: 502, headers },
    );
  }
}
