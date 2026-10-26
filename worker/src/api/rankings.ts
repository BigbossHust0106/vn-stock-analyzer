import {
  reweightNewsRow,
  validNewsWeight,
} from '../../../modules/news/ranking';
import type { rankStock } from '../../../modules/scoring/rankings';
import {
  referencePolicy,
  referenceRows,
} from '../../../modules/scoring/reference';
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
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  };
  const horizon = url.searchParams.get('horizon') ?? 'day',
    market = url.searchParams.get('exchange'),
    industry = url.searchParams.get('sector');
  const newsWeight = Number(
    url.searchParams.get('newsWeight') ?? env.NEWS_WEIGHT ?? 0.1,
  );
  const min = url.searchParams.get('minCap'),
    max = url.searchParams.get('maxCap');
  const numeric = (v: string | null) =>
    v === null ||
    (/^\d+(\.\d+)?$/.test(v) &&
      Number.isFinite(Number(v)) &&
      Number(v) <= 1e18);
  if (
    (url.searchParams.has('newsWeight') &&
      !url.searchParams.get('newsWeight')?.trim()) ||
    !validNewsWeight(newsWeight) ||
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
      { data: inputs, error },
      { data: runs, error: runError },
      { data: sectors, error: sectorError },
    ] = await Promise.all([
      db.rpc('ranking_news_inputs', {
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
    if (!Array.isArray(inputs) || inputs.length > 2000)
      throw Error('Phạm vi xếp hạng vượt giới hạn kiểm tra');
    type InputRow = {
      stock_id: string;
      symbol: string;
      score: number | null;
      explanation: ReturnType<typeof rankStock>[number]['explanation'];
    };
    const mixed = (inputs as InputRow[]).map((row) =>
      reweightNewsRow(row, newsWeight, new Date().toISOString()),
    );
    const eligible = (row: (typeof mixed)[number]) =>
      row.score !== null &&
      row.explanation.coverage === 1 &&
      row.explanation.rankingEligibility.policy === 'complete-v1' &&
      row.explanation.rankingEligibility.eligible &&
      row.explanation.rankingEligibility.quoteVerified &&
      row.explanation.rankingEligibility.financialCoverage === 1 &&
      row.explanation.rankingEligibility.blockers.length === 0;
    const seen = new Set<string>();
    const data = mixed
      .filter(eligible)
      .filter((row) => {
        if (seen.has(row.stock_id) || seen.has(row.symbol)) return false;
        seen.add(row.stock_id);
        seen.add(row.symbol);
        return true;
      })
      .sort((a, b) => b.score! - a.score! || a.symbol.localeCompare(b.symbol))
      .slice(0, 10)
      .map((row, i) => ({ ...row, position: i + 1 }));
    const excluded = mixed
      .filter((row) => !eligible(row))
      .sort(
        (a, b) =>
          b.explanation.coverage - a.explanation.coverage ||
          a.symbol.localeCompare(b.symbol),
      )
      .slice(0, 100)
      .map((row) => ({ ...row, position: null }));
    const reference =
      data.length < 10
        ? referenceRows(
            mixed.filter((row) => !eligible(row)),
            new Set(data.flatMap((row) => [row.stock_id, row.symbol])),
          )
        : [];
    return Response.json(
      {
        newsWeight,
        data,
        excluded,
        reference,
        referencePolicy,
        qualityPolicy: 'complete-v1',
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
