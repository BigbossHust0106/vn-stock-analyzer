import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import {
  newsSources,
  enabledSource,
  newsUserAgent,
} from '../../../modules/news/sources';
import {
  boundedText,
  plainText,
  parseRss,
  createTitleMatcher,
  digest,
  normalizedTitle,
} from '../../../modules/news/rss';
import { robotsAllowed } from '../../../modules/news/rss';
import {
  analyzeArticle,
  isPromotional,
  llmConfigured,
  createArticleTagger,
  type ClassifiedArticle,
  type StockTag,
} from '../../../modules/news/analysis';
import { newsSentiment } from '../../../modules/news/sentiment';
export async function collectNews(
  db: SupabaseClient,
  env: Env,
  timestamp: number,
  fetcher: typeof fetch = fetch,
) {
  const asOf = new Date(timestamp).toISOString();
  const { data: claimed, error: claimError } = await db.rpc(
    'claim_news_ingestion',
  );
  if (claimError) throw Error('Không lấy được khóa Cron tin tức');
  if (!claimed) return { skipped: true };
  try {
    const stocks: (StockTag & { id: string })[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await db
        .from('stocks')
        .select('id,symbol,name,sector')
        .eq('active', true)
        .order('id')
        .range(start, start + 999);
      if (error || !data) throw Error('Không đọc được danh mục gắn tin');
      stocks.push(...data);
      if (data.length < 1000) break;
    }
    const cutoff = new Date(timestamp - 7 * 86400000).toISOString();
    const rows: ClassifiedArticle[] = [];
    for (let start = 0; ; start += 1000) {
      if (start >= 10000)
        throw Error(
          'Phạm vi tin vượt giới hạn; không tính trên dữ liệu bị cắt',
        );
      const { data, error } = await db
        .from('news_feed_articles')
        .select('*')
        .gte('published_at', cutoff)
        .order('id')
        .range(start, start + 999);
      if (error || !data) throw Error('Không đọc được tin cũ');
      rows.push(...(data as ClassifiedArticle[]));
      if (data.length < 1000) break;
    }
    const dirty = new Set<string>();
    for (const a of rows) {
      const title = plainText(a.title),
        excerpt = plainText(a.excerpt);
      if (title !== a.title || excerpt !== a.excerpt) {
        if (title !== a.title)
          a.fingerprint = await digest(normalizedTitle(title));
        a.title = title;
        a.excerpt = excerpt;
        a.analysis = null;
        a.analysis_status = 'pending';
        a.model = null;
        a.analyzed_at = null;
        a.analysis_attempts = 0;
        a.last_attempt_at = null;
        dirty.add(a.id);
      }
    }
    const observed = new Set<string>(),
      matchesTitle = createTitleMatcher(),
      tagArticle = createArticleTagger(stocks);
    let inserted = 0,
      failed = 0;
    for (const source of newsSources) {
      let state = 'ok',
        note = 'Chỉ RSS: tiêu đề, mô tả ngắn và link gốc; không tải toàn văn.',
        count = 0;
      if (!enabledSource(source, env.NEWS_RSS_PERMISSION)) {
        state = 'policy_blocked';
        note =
          'Chưa xác nhận phạm vi cá nhân/phi lợi nhuận hoặc quyền sử dụng RSS của nguồn.';
      } else
        try {
          const robots = await boundedText(
            await fetcher(source.origin + '/robots.txt', {
              headers: { 'User-Agent': newsUserAgent },
              redirect: 'manual',
              signal: AbortSignal.timeout(12000),
            }),
            100000,
          );
          if (!/^User-agent\s*:/im.test(robots) || /<html/i.test(robots))
            throw Error('Không xác minh được robots');
          for (const path of source.feeds) {
            if (!robotsAllowed(robots, path)) {
              state = 'robots_blocked';
              note = 'Robots không cho phép một feed; không vượt chặn.';
              continue;
            }
            const articles = await parseRss(
              await boundedText(
                await fetcher(source.origin + path, {
                  headers: { 'User-Agent': newsUserAgent },
                  redirect: 'manual',
                  signal: AbortSignal.timeout(15000),
                }),
              ),
              source,
              asOf,
            );
            for (const a of articles) {
              if (isPromotional(a)) continue;
              if (observed.has(a.id)) continue;
              observed.add(a.id);
              const previous = rows.findIndex((r) => r.id === a.id);
              if (
                previous >= 0 &&
                rows[previous]!.title === a.title &&
                rows[previous]!.excerpt === a.excerpt
              )
                continue;
              if (
                rows.some(
                  (r) =>
                    r.id !== a.id &&
                    (r.fingerprint === a.fingerprint ||
                      matchesTitle(r.title, a.title)),
                )
              )
                continue;
              const row: ClassifiedArticle = {
                ...a,
                ...tagArticle(a),
                analysis: null,
                analysis_status: 'pending',
                analysis_attempts: 0,
                last_attempt_at: null,
                model: null,
                analyzed_at: null,
              };
              if (previous >= 0) rows[previous] = row;
              else rows.push(row);
              inserted++;
              count++;
            }
          }
        } catch {
          state = 'failed';
          note =
            'RSS/robots lỗi; giữ dữ liệu cũ với thời gian gốc, không tự điền tin.';
        }
      if (state !== 'ok') failed++;
      const { error } = await db.from('news_sources').upsert({
        id: source.id,
        name: source.name,
        terms_url: source.termsUrl,
        state,
        checked_at: asOf,
        article_count: count,
        note,
      });
      if (error) throw Error('Không ghi được trạng thái nguồn tin');
    }
    // bounded batch: prioritize direct issuer news, then macro/market context; no unbounded LLM spending.
    const pending = rows
      .filter(
        (a) =>
          !isPromotional(a) &&
          a.analysis_status !== 'ok' &&
          (a.analysis_attempts ?? 0) < 3 &&
          (!a.last_attempt_at ||
            timestamp - Date.parse(a.last_attempt_at) >= 3600000),
      )
      .sort(
        (a, b) =>
          Number(b.symbols.length > 0) - Number(a.symbols.length > 0) ||
          b.published_at.localeCompare(a.published_at),
      )
      .slice(0, 6);
    let analyzed = 0;
    if (llmConfigured(env))
      for (const a of pending) {
        a.analysis_attempts = (a.analysis_attempts ?? 0) + 1;
        a.last_attempt_at = asOf;
        try {
          a.analysis = await analyzeArticle(a, env, fetcher);
          a.analysis_status = 'ok';
          a.model = env.NEWS_LLM_MODEL!;
          a.analyzed_at = asOf;
          analyzed++;
        } catch {
          a.analysis = null;
          a.analysis_status = 'failed';
          a.analyzed_at = null;
        }
      }
    const changed = rows.filter(
      (a) => a.fetched_at === asOf || pending.includes(a) || dirty.has(a.id),
    );
    for (let offset = 0; offset < changed.length; offset += 500) {
      const { error } = await db
        .from('news_feed_articles')
        .upsert(changed.slice(offset, offset + 500), { onConflict: 'id' });
      if (error) throw Error('Không ghi được tin RSS');
    }
    // newsSentiment excludes multi-issuer/context articles. Partition once instead
    // of sorting and validating the complete feed again for every listed stock.
    const issuerArticles = new Map<string, ClassifiedArticle[]>();
    for (const a of rows) {
      if (a.symbols.length !== 1) continue;
      const symbol = a.symbols[0]!;
      const group = issuerArticles.get(symbol) ?? [];
      group.push(a);
      issuerArticles.set(symbol, group);
    }
    const scoreRows = stocks.map((s) => ({
      stock_id: s.id,
      score: null as number | null,
      payload: newsSentiment(
        issuerArticles.get(s.symbol) ?? [],
        s.symbol,
        asOf,
      ),
      updated_at: asOf,
    }));
    for (const row of scoreRows) {
      if (failed) {
        row.payload.score = null;
        row.payload.coverage = 0;
        row.payload.reason =
          'không đủ dữ liệu: ' +
          failed +
          ' nguồn RSS chưa đồng bộ thành công; giữ tin cũ để đọc, không chấm điểm đầy đủ.';
      }
      row.score = row.payload.score;
    }
    for (let i = 0; i < scoreRows.length; i += 500) {
      const { error } = await db
        .from('news_scores')
        .upsert(scoreRows.slice(i, i + 500));
      if (error) throw Error('Không ghi được điểm tin tức');
    }
    const { error: pruneError } = await db
      .from('news_feed_articles')
      .delete()
      .lt('published_at', new Date(timestamp - 30 * 86400000).toISOString());
    if (pruneError) throw Error('Không dọn được cache tin hết hạn');
    const { error: statusError } = await db
      .from('system_status')
      .update({
        state:
          failed ||
          !llmConfigured(env) ||
          rows.some((a) => !isPromotional(a) && a.analysis_status !== 'ok')
            ? 'degraded'
            : 'ok',
        ...(!failed ? { last_success_at: asOf } : {}),
        updated_at: asOf,
      })
      .eq('component', 'news');
    if (statusError) throw Error('Không cập nhật trạng thái tin tức');
    return {
      inserted,
      analyzed,
      sourceFailures: failed,
      llmConfigured: llmConfigured(env),
    };
  } finally {
    const { error } = await db.rpc('release_news_ingestion');
    if (error)
      console.error(
        'Không giải phóng được khóa tin tức; lease sẽ tự hết hạn sau 10 phút',
      );
  }
}
export async function syncNews(env: Env, timestamp: number) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw Error('Thiếu quyền đồng bộ tin tức');
  return collectNews(
    createClient(
      env.SUPABASE_URL || deployment.supabaseUrl,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
    env,
    timestamp,
  );
}
