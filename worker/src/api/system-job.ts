import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../index';
import { runMaintenance } from '../jobs/scheduled';
export async function systemJobResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const path = '/v1/internal/system-sync';
  if (new URL(request.url).pathname !== path) return null;
  const headers = { 'Cache-Control': 'no-store' };
  if (request.method !== 'POST')
    return Response.json(
      { error: 'Chỉ hỗ trợ POST' },
      { status: 405, headers },
    );
  const key = env.SUPABASE_SERVICE_ROLE_KEY,
    stamp = request.headers.get('X-Job-Timestamp') ?? '',
    signature = request.headers.get('X-Job-Signature') ?? '';
  if (
    !key ||
    key.length < 32 ||
    !/^\d{13}$/.test(stamp) ||
    Math.abs(Date.now() - Number(stamp)) > 60000 ||
    !/^\w{64}$/.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(
        createHmac('sha256', key)
          .update(stamp + ':POST:' + path)
          .digest('hex'),
        'utf8',
      ),
    )
  )
    return Response.json(
      { error: 'Không có quyền chạy tác vụ' },
      { status: 401, headers },
    );
  try {
    const result = await runMaintenance(env, Number(stamp));
    return Response.json(
      { result },
      {
        status: Object.values(result).some((r) => r.state === 'failed')
          ? 502
          : 200,
        headers,
      },
    );
  } catch {
    return Response.json(
      { error: 'Tác vụ lỗi; xem trang trạng thái hệ thống.' },
      { status: 502, headers },
    );
  }
}
