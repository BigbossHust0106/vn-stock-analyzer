import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import { serviceDatabase } from '../jobs/database';
import { emailConfigured } from '../alerts/email';
import deployment from '../../../config/public-deployment.json';
import { boundedText } from '../../../modules/news/rss';
export async function notificationsResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['/v1/notifications', '/v1/notifications/test'].includes(path))
    return null;
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const token = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token) return reply({ error: 'Cần đăng nhập' }, 401);
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: 'Chưa cấu hình đăng nhập' }, 503);
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
      return reply({ error: 'Phiên không hợp lệ' }, 401);
    if (path.endsWith('/test')) {
      if (request.method !== 'POST')
        return reply({ error: 'Chỉ hỗ trợ POST' }, 405);
      if (Number(request.headers.get('Content-Length') ?? 0) > 2000)
        return reply({ error: 'Yêu cầu quá lớn' }, 413);
      let body: string;
      try {
        body = await boundedText(new Response(request.body), 2000);
      } catch {
        return reply({ error: 'Yêu cầu quá lớn' }, 413);
      }
      let value: { watchlistId?: unknown; stockId?: unknown; email?: unknown };
      try {
        value = JSON.parse(body);
      } catch {
        return reply({ error: 'Dữ liệu không hợp lệ' }, 400);
      }
      const uuid = (v: unknown): v is string =>
        typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
      if (
        !value ||
        !uuid(value.watchlistId) ||
        !uuid(value.stockId) ||
        (value.email !== undefined && typeof value.email !== 'boolean')
      )
        return reply({ error: 'Chọn mã trong danh sách theo dõi' }, 400);
      const { data, error } = await serviceDatabase(env).rpc(
        'create_test_alert',
        {
          owner: user.user.id,
          list: value.watchlistId,
          stock: value.stockId,
          send_email: value.email === true,
        },
      );
      if (error)
        return reply(
          {
            error:
              error.message === 'ALERT_TEST_RATE_LIMIT'
                ? 'Chỉ gửi thử một lần mỗi phút.'
                : 'Không tạo được cảnh báo; mã phải thuộc watchlist của bạn.',
          },
          error.message === 'ALERT_TEST_RATE_LIMIT' ? 429 : 400,
        );
      return reply({ id: data, emailConfigured: emailConfigured(env) });
    }
    if (request.method !== 'GET')
      return reply({ error: 'Chỉ hỗ trợ GET' }, 405);
    const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      return reply({ error: 'Trang không hợp lệ' }, 400);
    const [{ data, error }, { count, error: countError }] = await Promise.all([
      db
        .from('notifications')
        .select(
          'id,stock_id,watchlist_id,kind,title,body,source_url,evidence,created_at,read_at,stocks(symbol)',
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + 49),
      db
        .from('notifications')
        .select('id', { head: true, count: 'exact' })
        .is('read_at', null),
    ]);
    if (error || countError) throw Error('Read failed');
    const ids = (data ?? []).map((n) => n.id);
    const emails = ids.length
      ? await serviceDatabase(env)
          .from('alert_email_outbox')
          .select('notification_id,state,attempts,code')
          .in('notification_id', ids)
      : { data: [], error: null };
    if (emails.error) throw Error('Cannot read own email receipts');
    return reply({
      data,
      unread: count ?? 0,
      email: emails.data,
      emailConfigured: emailConfigured(env),
    });
  } catch {
    return reply({ error: 'Không xử lý được thông báo; thử lại sau.' }, 502);
  }
}
