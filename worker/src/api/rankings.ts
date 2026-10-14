import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
export async function rankingsResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/rankings') return null;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=15',
    'X-Content-Type-Options': 'nosniff',
  };
  const horizon = url.searchParams.get('horizon') ?? 'day',
    market = url.searchParams.get('exchange'),
    industry = url.searchParams.get('sector');
  const min = url.searchParams.get('minCap'),
    max = url.searchParams.get('maxCap');
  const numeric = (v: string | null) =>
    v === null ||
    (/^\d+(\.\d+)?$/.test(v) &&
      Number.isFinite(Number(v)) &&
      Number(v) <= 1e18);
  if (
    !['day', 'month', 'quarter'].includes(horizon) ||
    (market !== null && !['HOSE', 'HNX', 'UPCOM'].includes(market)) ||
    (industry !== null && (!industry.trim() || industry.length > 120)) ||
    !numeric(min) ||
    !numeric(max) ||
    (min !== null && max !== null && Number(min) >= Number(max))
  )
    return Response.json(
      { error: 'Bộ lọc không hợp lệ' },
      { status: 400, headers },
    );
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json(
      { error: 'Nguồn chưa được cấu hình' },
      { status: 503, headers },
    );
  try {
    const db = createClient(
      env.SUPABASE_URL || deployment.supabaseUrl,
      env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const [
      { data, error },
      { data: runs, error: runError },
      { data: sectors, error: sectorError },
    ] = await Promise.all([
      db.rpc('top_rankings', {
        period: horizon,
        market,
        industry,
        min_cap: min === null ? null : Number(min),
        max_cap: max === null ? null : Number(max),
      }),
      db
        .from('ranking_runs')
        .select('*')
        .eq('model_version', 'top10-v1')
        .order('as_of', { ascending: false })
        .limit(1),
      db.from('stocks').select('sector').not('sector', 'is', null).limit(1000),
    ]);
    if (error || runError || sectorError) throw new Error('Read failed');
    return Response.json(
      {
        data,
        run: runs?.[0] ?? null,
        sectors: [
          ...new Set((sectors ?? []).map((s) => s.sector as string)),
        ].sort(),
        disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Không đọc được xếp hạng; kiểm tra nguồn và migration' },
      { status: 502, headers },
    );
  }
}
