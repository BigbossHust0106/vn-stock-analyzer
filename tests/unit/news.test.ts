import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  parseRss,
  plainText,
  canonicalUrl,
  duplicateTitle,
  boundedText,
  robotsAllowed,
} from '../../modules/news/rss';
import { newsSources, enabledSource } from '../../modules/news/sources';
import {
  analyzeArticle,
  factorApplies,
  tagArticle,
  validAnalysis,
  type ClassifiedArticle,
} from '../../modules/news/analysis';
import { newsSentiment } from '../../modules/news/sentiment';
import { integrateNews, reweightNewsRow } from '../../modules/news/ranking';
import { rankStock } from '../../modules/scoring/rankings';
import { collectNews } from '../../worker/src/news/sync';
import worker from '../../worker/src/index';
const asOf = '2026-10-15T08:00:00Z',
  source = newsSources[0]!;
const title = 'DPR công bố kết quả kinh doanh quý III năm 2026';
function xml(
  url = 'https://cafef.vn/test.chn',
  heading = title,
  date = 'Thu, 15 Oct 2026 14:00:00 +0700',
) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><item><title><![CDATA[${heading}]]></title><link>${url.replaceAll('&', '&amp;')}</link><pubDate>${date}</pubDate><description><![CDATA[<a href="https://evil.test">DPR</a> ghi nhận doanh thu 100 tỷ đồng.]]></description></item></channel></rss>`;
}
async function article(
  patch: Partial<ClassifiedArticle> = {},
): Promise<ClassifiedArticle> {
  const a = (await parseRss(xml(), source, asOf))[0]!;
  return {
    ...a,
    symbols: ['DPR'],
    sectors: ['Cao su'],
    factors: ['corporate'],
    macro_topics: [],
    analysis_status: 'ok',
    model: 'test',
    analyzed_at: asOf,
    analysis: {
      summary: title,
      evidence: title,
      sentiment: 'positive',
      impact: 'high',
      horizon: 'short',
    },
    ...patch,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('RSS: nguồn thực có giới hạn, mã hóa và loại trùng', () => {
  it('đọc RSS2, VND/giờ VN và loại HTML/URL tracking nhưng giữ link bài gốc', async () => {
    const a = (
      await parseRss(
        xml('https://cafef.vn/test.chn?utm_source=x&fbclid=1#part'),
        source,
        asOf,
      )
    )[0]!;
    expect(a.source_url).toBe('https://cafef.vn/test.chn');
    expect(a.published_at).toBe('2026-10-15T07:00:00.000Z');
    expect(a.excerpt).toBe('DPR ghi nhận doanh thu 100 tỷ đồng.');
    expect(a.id).toMatch(/^[a-f0-9]{64}$/);
    expect(
      plainText(
        '<script>steal()</script><style>bad</style>A &amp; B &#x0111; &#273; &nbsp;',
      ),
    ).toBe('A & B đ đ');
    expect(plainText(42)).toBe('');
  });
  it('không lấy tin tương lai/cũ/sai link/ngày, không XML entity hay trang HTML', async () => {
    for (const content of [
      xml('https://evil.test/a'),
      xml('https://cafef.vn/test.chn', title, 'bad'),
      xml(
        'https://cafef.vn/test.chn',
        title,
        'Thu, 15 Oct 2026 19:00:00 +0700',
      ),
      xml(
        'https://cafef.vn/test.chn',
        title,
        'Thu, 01 Oct 2026 12:00:00 +0700',
      ),
    ])
      expect(await parseRss(content, source, asOf)).toEqual([]);
    await expect(
      parseRss('<!DOCTYPE rss><rss/>', source, asOf),
    ).rejects.toThrow();
    await expect(parseRss('<html/>', source, asOf)).rejects.toThrow();
    await expect(parseRss('x'.repeat(2000001), source, asOf)).rejects.toThrow();
    await expect(parseRss(xml(), source, 'bad')).rejects.toThrow();
    for (const url of [
      'javascript:alert(1)',
      'https://cafef.vn.evil.test/x',
      'https://u:p@cafef.vn/x',
      'https://cafef.vn:99/x',
      null,
    ])
      expect(canonicalUrl(url, source)).toBeNull();
  });
  it('trùng tiêu đề khác dấu câu/tracking không tăng điểm, khác số liệu không gộp', () => {
    expect(
      duplicateTitle(
        'DPR: công bố lợi nhuận quý III tăng 10%',
        'DPR công bố lợi nhuận quý III tăng 10%',
      ),
    ).toBe(true);
    expect(
      duplicateTitle(
        'DPR công bố lợi nhuận quý III tăng 10%',
        'DPR công bố lợi nhuận quý III tăng 20%',
      ),
    ).toBe(false);
    expect(duplicateTitle('A B', 'A C')).toBe(false);
  });
  it('giới hạn bytes cả khi không có Content-Length', async () => {
    expect(await boundedText(new Response('abc'), 3)).toBe('abc');
    await expect(boundedText(new Response('abcd'), 3)).rejects.toThrow();
    await expect(
      boundedText(new Response('', { status: 503 })),
    ).rejects.toThrow();
  });
  it('robots ưu tiên nhóm bot riêng, luật dài nhất và Allow khi bằng độ dài', () => {
    const text =
      'User-agent: *\nDisallow: /private\nAllow: /private/rss\nDisallow: /*.js$\nUser-agent: SpecialBot\nDisallow: /';
    expect(robotsAllowed(text, '/private/feed')).toBe(false);
    expect(robotsAllowed(text, '/private/rss')).toBe(true);
    expect(robotsAllowed(text, '/a.js')).toBe(false);
    expect(robotsAllowed(text, '/a.js/more')).toBe(true);
    expect(robotsAllowed(text, '/x', 'specialbot')).toBe(false);
    expect(robotsAllowed('User-agent: *\nDisallow: /x\nAllow: /x', '/x')).toBe(
      true,
    );
    expect(enabledSource(newsSources[2]!)).toBe(false);
    expect(enabledSource(newsSources[2]!, 'personal-nonprofit')).toBe(true);
    expect(enabledSource(source)).toBe(true);
  });
});
it('gắn mã/ngành và 6 chủ đề vĩ mô; VND không bị nhầm thành ticker khi chỉ là đơn vị', () => {
  const stocks = [
    {
      symbol: 'DPR',
      name: 'Công ty Cổ phần Cao su Đồng Phú',
      sector: 'Cao su',
    },
    {
      symbol: 'VND',
      name: 'Công ty Chứng khoán VNDIRECT',
      sector: 'Chứng khoán',
    },
  ];
  const tag = tagArticle(
    {
      title: 'Cao su Đồng Phú DPR trả cổ tức, doanh thu 100 tỷ VND',
      excerpt:
        'NHNN đổi lãi suất, tỷ giá USD/VND; CPI, giá dầu Brent và giá vàng. Khối ngoại, thanh khoản tăng.',
    },
    stocks,
  );
  expect(tag.symbols).toEqual(['DPR']);
  expect(tag.sectors).toContain('Cao su');
  expect(tag.macro_topics).toEqual([
    'interest',
    'fx',
    'cpi',
    'sbv',
    'oil',
    'gold',
  ]);
  expect(tag.factors).toEqual([
    'macro',
    'sector',
    'corporate',
    'foreign',
    'liquidity',
  ]);
  expect(
    tagArticle({ title: 'Cổ phiếu VND tăng', excerpt: '' }, stocks).symbols,
  ).toContain('VND');
});
it('LLM tóm tắt có bằng chứng nguyên văn; từ chối số bịa, nhãn sai, prompt injection và lỗi API', async () => {
  const a = await article();
  const result = a.analysis!;
  expect(validAnalysis(result, a)).toBe(true);
  expect(
    validAnalysis({ ...result, summary: 'Lợi nhuận tăng 999 tỷ đồng' }, a),
  ).toBe(false);
  expect(validAnalysis({ ...result, sentiment: 'bullish' }, a)).toBe(false);
  expect(validAnalysis(null, a)).toBe(false);
  const env = {
    NEWS_LLM_API_KEY: 'unit-secret',
    NEWS_LLM_BASE_URL: 'https://llm.example.test/v1',
    NEWS_LLM_MODEL: 'test-model',
  };
  const f = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      choices: [{ message: { content: JSON.stringify(result) } }],
    }),
  );
  expect(await analyzeArticle(a, env, f)).toEqual(result);
  expect(String(f.mock.calls[0]![0])).toBe(
    'https://llm.example.test/v1/chat/completions',
  );
  await expect(analyzeArticle(a, {}, f)).rejects.toThrow('Chưa cấu hình');
  await expect(
    analyzeArticle(a, { ...env, NEWS_LLM_BASE_URL: 'http://localhost' }, f),
  ).rejects.toThrow('Endpoint');
  await expect(
    analyzeArticle(
      a,
      env,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ ...result, summary: 'Bịa số 999' }),
              },
            },
          ],
        }),
      ),
    ),
  ).rejects.toThrow('bằng chứng');
  await expect(
    analyzeArticle(
      a,
      env,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [] })),
    ),
  ).rejects.toThrow('không có');
});
it('điểm tin có đáp án tính tay: 3×(+1)+1×(−1), tổng4 → 75; không nhân đôi cùng tin', async () => {
  const a = await article(),
    b = await article({
      id: 'second',
      title: 'DPR thông báo kết quả quý II',
      source_url: 'https://vietstock.vn/new.htm',
      source_id: 'vietstock',
      analysis: {
        summary: 'DPR thông báo',
        evidence: 'DPR thông báo',
        sentiment: 'negative',
        impact: 'low',
        horizon: 'long',
      },
    });
  // Hai tin cùng thời điểm nên decay triệt tiêu: 50+50*(3−1)/(3+1)=75.
  const score = newsSentiment(
    [a, b, { ...a, id: 'dup', source_url: 'https://cafef.vn/duplicate.chn' }],
    'DPR',
    asOf,
  );
  expect(score.score).toBe(75);
  expect(score.count).toBe(2);
  expect(score.sourceCount).toBe(2);
  expect(
    newsSentiment([{ ...a, symbols: ['DPR', 'FPT'] }], 'DPR', asOf).score,
  ).toBeNull();
  const old = await article({ published_at: '2026-10-01T00:00:00Z' });
  expect(newsSentiment([old, a], 'VNM', asOf).score).toBeNull();
  expect(newsSentiment([old], 'DPR', asOf).score).toBeNull();
  expect(newsSentiment([a], 'DPR', 'bad').score).toBeNull();
  expect(
    newsSentiment(
      [{ ...a, analysis_status: 'pending', analysis: null }],
      'DPR',
      asOf,
    ).score,
  ).toBeNull();
  expect(
    newsSentiment([{ ...a, analyzed_at: '2026-10-16T00:00:00Z' }], 'DPR', asOf)
      .score,
  ).toBeNull();
});
function baseRow() {
  return rankStock({
    stockId: 'stock',
    financials: null,
    priceVnd: null,
    referenceVnd: null,
    quoteFetchedAt: null,
    bars: [],
    events: [],
    asOf,
  })[0]!;
}
it('tin tức 10%: 80×.9+100×.1=82; thiếu tin không coi 50 và không nới bộ lọc cơ bản', async () => {
  const base = baseRow();
  base.value = 80;
  base.explanation.coverage = 1;
  base.explanation.rankingEligibility = {
    policy: 'complete-v1',
    eligible: true,
    quoteVerified: true,
    financialCoverage: 1,
    blockers: [],
  };
  const news = newsSentiment([await article()], 'DPR', asOf),
    mixed = integrateNews(base, news, 0.1);
  expect(mixed.value).toBe(82);
  expect(mixed.explanation.coverage).toBe(1);
  expect(mixed.explanation.rankingEligibility.eligible).toBe(true);
  const absent = { ...news, score: null, count: 0 };
  const missing = integrateNews(base, absent, 0.1);
  expect(missing.value).toBe(72);
  expect(missing.explanation.coverage).toBe(0.9);
  expect(missing.explanation.rankingEligibility.eligible).toBe(false);
  expect(integrateNews(base, absent, 0).value).toBe(80);
  expect(
    integrateNews(baseRow(), news, 0.1).explanation.rankingEligibility.eligible,
  ).toBe(false);
  expect(() => integrateNews(base, news, NaN)).toThrow();
  expect(() => integrateNews(base, news, 0.31)).toThrow();
  const row = {
    stock_id: 'stock',
    score: mixed.value,
    explanation: mixed.explanation,
  };
  expect(reweightNewsRow(row, 0.3, asOf).score).toBe(86);
  expect(
    reweightNewsRow(row, 0.3, '2026-10-15T10:00:00Z').explanation
      .rankingEligibility.eligible,
  ).toBe(false);
});
it('API tin yêu cầu mã đúng và cấu hình, không gọi nguồn tùy ý', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  expect(
    (
      await worker.fetch(
        new Request('https://app.test/v1/news?symbol=DROP%20TABLE'),
      )
    ).status,
  ).toBe(400);
  expect(
    (await worker.fetch(new Request('https://app.test/v1/news?symbol=DPR')))
      .status,
  ).toBe(503);
  expect(f).not.toHaveBeenCalled();
});
it('Cron thu thập thiếu key vẫn lưu RSS nhưng không tạo cảm xúc/điểm giả, có khóa chống chồng', async () => {
  const writes: { table: string; body: unknown }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.includes('/rpc/claim_news_ingestion')) return Response.json(true);
    if (url.includes('/rpc/release_news_ingestion')) return Response.json(null);
    if (url.includes('db.example.test')) {
      const table = new URL(url).pathname.split('/').at(-1)!;
      if (init?.body)
        writes.push({ table, body: JSON.parse(String(init.body)) });
      if (table === 'stocks')
        return Response.json([
          { id: 's', symbol: 'DPR', name: 'Cao su Đồng Phú', sector: 'Cao su' },
        ]);
      return Response.json([]);
    }
    if (url.endsWith('/robots.txt'))
      return new Response('User-agent: *\nAllow: /');
    return new Response(xml(new URL('/test.chn', url).toString()));
  });
  vi.stubGlobal('fetch', fetcher);
  const db = createClient('https://db.example.test', 'public-test');
  const result = await collectNews(db, {}, Date.parse(asOf), fetcher);
  expect(result).toMatchObject({
    inserted: 1,
    analyzed: 0,
    llmConfigured: false,
  });
  const articles = writes
    .filter((w) => w.table === 'news_feed_articles')
    .flatMap((w) => w.body as ClassifiedArticle[]);
  expect(
    articles.every(
      (a) => a.analysis === null && a.analysis_status === 'pending',
    ),
  ).toBe(true);
  expect(writes.filter((w) => w.table === 'news_sources')).toHaveLength(4);
  expect(
    writes
      .filter((w) => w.table === 'news_scores')
      .flatMap((w) => w.body as { score: number | null }[])
      .every((r) => r.score === null),
  ).toBe(true);
  expect(
    fetcher.mock.calls.some((c) => String(c[0]).includes('chat/completions')),
  ).toBe(false);
});
it('API áp dụng điểm tin trước khi chọn Top10, không chỉ đổi điểm 10 mã đã chọn', async () => {
  const now = new Date().toISOString();
  const news = newsSentiment(
    [await article({ published_at: now, analyzed_at: now })],
    'DPR',
    now,
  );
  const rows = Array.from({ length: 12 }, (_, i) => {
    const base = baseRow();
    base.value = i === 11 ? 70 : 80;
    base.explanation.coverage = 1;
    base.explanation.rankingEligibility = {
      policy: 'complete-v1',
      eligible: true,
      quoteVerified: true,
      financialCoverage: 1,
      blockers: [],
    };
    const mixed = integrateNews(
      base,
      { ...news, score: i === 11 ? 100 : 0 },
      0.1,
    );
    return {
      stock_id: 'stock-' + i,
      symbol: 'T' + String(i).padStart(2, '0'),
      score: mixed.value,
      explanation: mixed.explanation,
    };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      String(input).includes('ranking_news_inputs')
        ? Response.json(rows)
        : Response.json([]),
    ),
  );
  const response = await worker.fetch(
    new Request('https://app.test/v1/rankings?newsWeight=0.3'),
    {
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_PUBLISHABLE_KEY: 'public',
    },
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    data: { symbol: string; score: number }[];
  };
  // T11:70*.7+100*.3=79; T00..T10:80*.7+0*.3=56. T11 đứng đầu dù nằm ngoài 10 dòng đầu.
  expect(result.data).toHaveLength(10);
  expect(result.data[0]).toMatchObject({ symbol: 'T11', score: 79 });
});
it('endpoint chạy tác vụ chỉ nhận POST và service credential, không cho browser/anon chạy', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  for (const method of ['GET', 'POST']) {
    const r = await worker.fetch(
      new Request('https://app.test/v1/internal/news-sync', { method }),
      {
        SUPABASE_SERVICE_ROLE_KEY:
          'server-key-never-in-the-browser-at-least-32',
      },
    );
    expect(r.status).toBe(method === 'POST' ? 401 : 405);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(f).not.toHaveBeenCalled();
});
it('RSS mã hóa HTML không hiện thẻ ảnh; bảng ngành không lẫn ngành khác hay khuyến mại', async () => {
  expect(plainText('P/E &lt; 15 và ROE &gt; 10%')).toBe(
    'P/E < 15 và ROE > 10%',
  );
  expect(plainText('&lt;img src=&quot;x&quot;&gt;Giá dầu tăng nhẹ')).toBe(
    'Giá dầu tăng nhẹ',
  );
  expect(
    plainText('&amp;lt;script&amp;gt;bad()&amp;lt;/script&amp;gt;Tin gốc'),
  ).toBe('Tin gốc');
  const a = await article({
    sectors: ['Chứng khoán'],
    factors: ['sector', 'macro', 'foreign'],
    symbols: ['FPT'],
  });
  expect(factorApplies(a, 'DPR', 'Cao su', 'sector')).toBe(false);
  expect(factorApplies(a, 'DPR', null, 'sector')).toBe(false);
  expect(factorApplies(a, 'DPR', 'Chứng khoán', 'sector')).toBe(true);
  expect(factorApplies(a, 'DPR', 'Cao su', 'foreign')).toBe(false);
  expect(
    factorApplies(
      { ...a, title: 'Khối ngoại bán ròng trên HOSE' },
      'DPR',
      null,
      'foreign',
    ),
  ).toBe(true);
  const promo = {
    ...a,
    title: 'DPR gia tăng ưu đãi và cơ hội nhận iPhone',
    symbols: ['DPR'],
    analysis: {
      ...a.analysis!,
      summary: 'DPR gia tăng ưu đãi',
      evidence: 'DPR gia tăng ưu đãi',
    },
  };
  expect(factorApplies(promo, 'DPR', 'Chứng khoán', 'sector')).toBe(false);
  expect(newsSentiment([promo], 'DPR', asOf).score).toBeNull();
});

it('tác vụ HMAC chấp nhận chữ ký mới, từ chối chữ ký hết hạn và không gửi service key đến Worker', async () => {
  const key = 'unit-test-server-key-long-enough-32-chars',
    stamp = String(Date.now()),
    signature = createHmac('sha256', key)
      .update(stamp + ':POST:/v1/internal/news-sync')
      .digest('hex');
  const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json(false));
  vi.stubGlobal('fetch', f);
  const request = new Request('https://app.test/v1/internal/news-sync', {
    method: 'POST',
    headers: { 'X-News-Timestamp': stamp, 'X-News-Signature': signature },
  });
  expect(request.headers.has('Authorization')).toBe(false);
  expect(
    (
      await worker.fetch(request, {
        SUPABASE_URL: 'https://db.example.test',
        SUPABASE_SERVICE_ROLE_KEY: key,
      })
    ).status,
  ).toBe(200);
  const old = String(Date.now() - 120000),
    oldSignature = createHmac('sha256', key)
      .update(old + ':POST:/v1/internal/news-sync')
      .digest('hex');
  expect(
    (
      await worker.fetch(
        new Request('https://app.test/v1/internal/news-sync', {
          method: 'POST',
          headers: {
            'X-News-Timestamp': old,
            'X-News-Signature': oldSignature,
          },
        }),
        { SUPABASE_SERVICE_ROLE_KEY: key },
      )
    ).status,
  ).toBe(401);
  expect(f).toHaveBeenCalledTimes(1);
});
