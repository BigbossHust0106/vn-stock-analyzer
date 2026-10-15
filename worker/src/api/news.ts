import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import type { NewsScore } from '../../../modules/news/sentiment';
import { newsSentiment } from '../../../modules/news/sentiment';
import { selectStockNews } from '../../../modules/news/relevance';
import { isPromotional } from '../../../modules/news/analysis';
import type { ClassifiedArticle } from '../../../modules/news/analysis';
export async function newsResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/news') return null;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  };
  const symbol = url.searchParams.get('symbol') ?? '';
  const scope = url.searchParams.get('scope') ?? 'stock';
  if (!['stock', 'context'].includes(scope))
    return Response.json(
      { error: 'Phạm vi tin không hợp lệ' },
      { status: 400, headers },
    );
  if (!/^[A-Z0-9]{3,12}$/.test(symbol))
    return Response.json(
      { error: 'Mã tin tức không hợp lệ' },
      { status: 400, headers },
    );
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json(
      { error: 'Chưa cấu hình nguồn tin' },
      { status: 503, headers },
    );
  try {
    const db = createClient(
      env.SUPABASE_URL || deployment.supabaseUrl,
      env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: stock, error: stockError } = await db
      .from('stocks')
      .select('id,symbol,sector')
      .eq('symbol', symbol)
      .eq('active', true)
      .maybeSingle();
    if (stockError) throw Error('Đọc mã lỗi');
    if (!stock)
      return Response.json(
        { error: 'Không tìm thấy mã' },
        { status: 404, headers },
      );
    const asOf = new Date().toISOString(),
      since = new Date(Date.now() - 7 * 86400000).toISOString();
    const [
      { data: direct, error: dErr },
      { data: context, error: cErr },
      { data: sources, error: sErr },
      { data: status, error: stErr },
      { data: snapshot, error: snapshotErr },
    ] = await Promise.all([
      db
        .from('news_feed_articles')
        .select('*')
        .contains('symbols', [symbol])
        .gte('published_at', since)
        .order('published_at', { ascending: false })
        .limit(100),
      scope === 'context'
        ? db
            .from('news_feed_articles')
            .select('*')
            .overlaps('factors', ['macro', 'sector', 'foreign', 'liquidity'])
            .gte('published_at', since)
            .order('published_at', { ascending: false })
            .limit(150)
        : Promise.resolve({ data: [], error: null }),
      db.from('news_sources').select('*').order('id'),
      db
        .from('system_status')
        .select('state,last_success_at,updated_at')
        .eq('component', 'news')
        .maybeSingle(),
      db
        .from('news_scores')
        .select('payload,updated_at')
        .eq('stock_id', stock.id)
        .maybeSingle(),
    ]);
    if (dErr || cErr || sErr || stErr || snapshotErr)
      throw Error('Đọc tin lỗi');
    const articles = selectStockNews(
      [
        ...new Map(
          [...(direct ?? []), ...(context ?? [])].map((a) => [
            a.id,
            a as ClassifiedArticle,
          ]),
        ).values(),
      ].filter((a) => !isPromotional(a)),
      symbol,
      stock.sector,
      scope === 'context',
    );
    const fresh =
      snapshot &&
      Date.parse(snapshot.updated_at) <= Date.parse(asOf) &&
      Date.parse(asOf) - Date.parse(snapshot.updated_at) <= 3600000;
    const score: NewsScore = fresh
      ? snapshot.payload
      : newsSentiment([], symbol, asOf);
    return Response.json(
      {
        symbol,
        sector: stock.sector,
        articles,
        sources,
        status,
        score,
        asOf,
        scope:
          'Tin RSS 7 ngày; ưu tiên mã được nhắc trực tiếp. Tin bối cảnh ngành/thị trường chỉ mở theo yêu cầu; không dùng cảm xúc chung để chấm riêng từng mã.',
        disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Không đọc được tin tức; không đủ dữ liệu' },
      { status: 502, headers },
    );
  }
}
