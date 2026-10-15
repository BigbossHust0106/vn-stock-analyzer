import { vietnamDate } from '../../../modules/market/calendar';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evaluateAlert,
  type AlertRule,
  type AlertSnapshot,
} from '../../../modules/alerts/evaluate';
import type { ClassifiedArticle } from '../../../modules/news/analysis';
export async function evaluateWatchlistAlerts(
  db: SupabaseClient,
  timestamp: number,
) {
  let emitted = 0,
    checked = 0;
  const asOf = new Date(timestamp).toISOString();
  for (let offset = 0; ; offset += 100) {
    const { data: rules, error } = await db
      .from('watchlist_alert_rules')
      .select('*')
      .eq('enabled', true)
      .order('id')
      .range(offset, offset + 99);
    if (error || !rules) throw Error('Không đọc được quy tắc cảnh báo');
    if (!rules.length) break;
    const ids = [...new Set(rules.map((r) => r.stock_id as string))];
    // Ownership FK targets watchlist_items, not stocks: resolve symbols explicitly.
    const { data: stocks, error: stockError } = await db
      .from('stocks')
      .select('id,symbol')
      .in('id', ids);
    if (stockError || !stocks || stocks.length !== ids.length)
      throw Error('Không đọc được mã cho cảnh báo');
    const symbols = stocks.map((s) => s.symbol as string);
    const results = await Promise.all([
      db
        .from('watchlist_alert_state')
        .select('*')
        .in(
          'rule_id',
          rules.map((r) => r.id),
        ),
      db
        .from('prices_current')
        .select('stock_id,last_price_vnd,fetched_at')
        .in('stock_id', ids),
      db
        .from('scores')
        .select('stock_id,horizon,value,computed_at,explanation')
        .in('stock_id', ids)
        .eq('model_version', 'top10-v1')
        .gte('as_of', vietnamDate(timestamp - 2 * 86400000))
        .order('computed_at', { ascending: false })
        .limit(1000),
      db
        .from('news_feed_articles')
        .select('*')
        .overlaps('symbols', symbols)
        .eq('analysis_status', 'ok')
        .gte('published_at', new Date(timestamp - 7 * 86400000).toISOString())
        .order('analyzed_at')
        .limit(1001),
    ]);
    if (results.some((r) => r.error))
      throw Error('Không đọc được đầu vào cảnh báo');
    // Never silently claim a complete news window after truncation.
    if ((results[3].data?.length ?? 0) > 1000)
      throw Error('Tin cảnh báo vượt giới hạn lô');
    const writes = [];
    for (const raw of rules) {
      const rule = raw as AlertRule,
        prior = results[0].data?.find((s) => s.rule_id === rule.id),
        q = results[1].data?.find((s) => s.stock_id === rule.stock_id),
        score = results[2].data?.find(
          (s) => s.stock_id === rule.stock_id && s.horizon === rule.horizon,
        );
      const result = evaluateAlert(
        rule,
        (prior?.snapshot ?? {}) as AlertSnapshot,
        {
          symbol: stocks.find((s) => s.id === rule.stock_id)?.symbol ?? '',
          asOf,
          price: q ? { value: q.last_price_vnd, asOf: q.fetched_at } : null,
          score: score
            ? {
                value: score.value,
                asOf: score.computed_at,
                complete:
                  score.explanation?.coverage === 1 &&
                  score.explanation?.rankingEligibility?.eligible === true,
              }
            : null,
          news: (results[3].data ?? []) as ClassifiedArticle[],
        },
      );
      writes.push({
        rule: rule.id,
        config: rule.config_version,
        expected_revision: prior?.revision ?? 0,
        snapshot: { ...result.state, checkedAt: asOf, reason: result.reason },
        events: result.events,
      });
      checked++;
    }
    const { data: count, error: writeError } = await db.rpc(
      'record_watchlist_alert_batch',
      { rows: writes },
    );
    if (writeError) throw Error('Không lưu được trạng thái/cảnh báo');
    emitted += Number(count);

    if (rules.length < 100) break;
  }
  return { checked, emitted };
}
