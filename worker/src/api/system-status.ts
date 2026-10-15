import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { emailConfigured } from '../alerts/email';
import { llmConfigured } from '../../../modules/news/analysis';
export async function systemStatusResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/v1/system-status') return null;
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method !== 'GET')
    return Response.json({ error: 'Chỉ hỗ trợ GET' }, { status: 405, headers });
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json(
      { error: 'Chưa cấu hình dữ liệu' },
      { status: 503, headers },
    );
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const [freshness, status, jobs, health, sources] = await Promise.all([
      db.rpc('system_data_freshness'),
      db.from('system_status').select('*'),
      db
        .from('system_job_runs')
        .select(
          'id,job,scheduled_at,started_at,finished_at,lease_until,attempts,state,code',
        )
        .order('started_at', { ascending: false })
        .limit(60),
      db.from('api_health').select('*'),
      db.from('news_sources').select('id,name,state,checked_at,note'),
    ]);
    if ([freshness, status, jobs, health, sources].some((r) => r.error))
      throw Error('Read failed');
    return Response.json(
      {
        asOf: new Date().toISOString(),
        freshness: freshness.data,
        status: status.data,
        jobs: jobs.data,
        health: health.data,
        sources: sources.data,
        configuration: { email: emailConfigured(env), llm: llmConfigured(env) },
        notice:
          'Thời gian nhận dữ liệu không xác nhận thời điểm phát sinh tại sàn hoặc tính đầy đủ của mô hình.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Không đọc được trạng thái hệ thống; không đủ dữ liệu.' },
      { status: 502, headers },
    );
  }
}
