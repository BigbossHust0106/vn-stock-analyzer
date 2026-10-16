import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentReply, AgentSource } from '../../../modules/agent/plan';
import { isFinancialData } from '../../../modules/providers/financial-types';
import { scoreStock } from '../../../modules/scoring/engine';
import { availableAnnual } from '../../../modules/strategies/strategy';
import { liveQuotes, persistQuotes } from '../live-quotes';
const number = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? 'không đủ dữ liệu'
    : v.toLocaleString('vi-VN', { maximumFractionDigits: digits });
export async function research(
  db: SupabaseClient,
  symbols: string[],
  writer?: SupabaseClient,
): Promise<AgentReply> {
  const blocks: string[] = [],
    sources: AgentSource[] = [];
  const asOf = new Date().toISOString();
  let fresh: Awaited<ReturnType<typeof liveQuotes>> = [];
  try {
    fresh = await liveQuotes(symbols);
    if (writer) await persistQuotes(writer, fresh);
  } catch {
    /* Preserve stored source time; do not fabricate fresh data. */
  }
  for (const symbol of symbols) {
    const { data: s, error } = await db
      .from('stocks')
      .select('id,symbol,name,exchange')
      .eq('symbol', symbol)
      .eq('active', true)
      .maybeSingle();
    if (error) throw Error('DATA_UNAVAILABLE');
    if (!s) {
      blocks.push(`${symbol}: không tìm thấy mã active trên HOSE/HNX/UPCOM.`);
      continue;
    }
    const [f, q, news] = await Promise.all([
      db
        .from('financial_snapshots')
        .select('payload,fetched_at')
        .eq('stock_id', s.id)
        .maybeSingle(),
      db
        .from('prices_current')
        .select('last_price_vnd,reference_vnd,fetched_at')
        .eq('stock_id', s.id)
        .maybeSingle(),
      db
        .from('news_feed_articles')
        .select('title,source_url,published_at')
        .contains('symbols', [symbol])
        .gte('published_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('published_at', { ascending: false })
        .limit(3),
    ]);
    if (f.error || q.error || news.error) throw Error('DATA_UNAVAILABLE');
    const financials = isFinancialData(f.data?.payload) ? f.data.payload : null;
    const quote = fresh.find((p) => p.symbol === symbol),
      price = quote ? quote.lastPriceVnd : (q.data?.last_price_vnd ?? null),
      stamp = quote?.fetchedAt ?? q.data?.fetched_at ?? null;
    const report = scoreStock(financials, price, asOf, undefined, stamp),
      annual = availableAnnual(financials, asOf).at(-1);
    const lines = [
      `${symbol} · ${s.name} · ${s.exchange}`,
      `Giá VPS gần nhất: ${number(price)} VND. Nhận lúc ${stamp ?? 'chưa có'}; chưa xác minh timestamp sàn${quote ? '' : '; dùng snapshot lưu, chưa lấy được phản hồi mới'}.`,
      annual
        ? `BCTC năm ${annual.year}, công bố ${annual.publishedAt}: doanh thu ${number(annual.revenueVnd)} VND; lợi nhuận cổ đông mẹ ${number(annual.parentProfitVnd)} VND; EPS năm ${number(annual.epsAnnualVnd, 2)} VND; BVPS ${number(annual.bvpsVnd, 2)} VND; ROE ${number(annual.roe === null ? null : annual.roe * 100, 2)}%.`
        : 'BCTC: không đủ dữ liệu năm đã công bố.',
    ];
    for (const strategy of report.strategies) {
      lines.push(
        `${strategy.name}: ${number(strategy.score, 2)}/100, bao phủ ${number(strategy.coverage * 100)}%. Giá trị nội tại: ${strategy.intrinsicVnd.ok ? number(strategy.intrinsicVnd.value, 2) + ' VND' : 'không đủ dữ liệu'}. Biên an toàn: ${strategy.marginOfSafety.ok ? number(strategy.marginOfSafety.value * 100, 2) + '%' : 'không đủ dữ liệu'}.`,
      );
      for (const c of strategy.criteria)
        lines.push(
          `• ${c.label}: ${c.status === 'pass' ? 'đạt' : c.status === 'fail' ? 'chưa đạt' : 'không đủ dữ liệu'} — ${c.explanation}`,
        );
    }
    lines.push(
      `Kết luận engine: ${report.conclusion}. Tin cậy ${report.confidence}% là mức hoàn thiện bằng chứng, không phải xác suất sinh lời.`,
      ...report.risks.slice(0, 4).map((r) => '• Rủi ro: ' + r),
    );
    for (const a of news.data ?? [])
      if (
        typeof a.source_url === 'string' &&
        /^https:\/\/(cafef\.vn|vietstock\.vn|vneconomy\.vn|vnexpress\.net)\//.test(
          a.source_url,
        )
      ) {
        lines.push('Tin trực tiếp: ' + a.title);
        sources.push({
          label: a.title,
          url: a.source_url,
          receivedAt: a.published_at,
        });
      }
    blocks.push(lines.join('\n'));
    sources.push({
      label: `Dữ liệu và giải thích ${symbol}`,
      url: '/stocks?symbol=' + symbol,
      receivedAt: f.data?.fetched_at ?? stamp,
    });
  }
  return {
    text:
      (symbols.length > 1
        ? 'So sánh trên cùng định nghĩa; thiếu dữ liệu không được quy về 0 hoặc tự kết luận mã nào tốt hơn.\n\n'
        : '') +
      blocks.join('\n\n') +
      '\n\nChỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
    sources,
  };
}
