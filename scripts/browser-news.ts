import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { authenticateBrowser } from './browser-auth';
import { managementClient } from './sync-rankings';
import type { ClassifiedArticle } from '../modules/news/analysis';
import { validAnalysis } from '../modules/news/analysis';
import type { NewsScore } from '../modules/news/sentiment';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const { db } = await managementClient();
const { data: analyzed, error } = await db
  .from('news_feed_articles')
  .select('symbols')
  .eq('analysis_status', 'ok')
  .order('published_at', { ascending: false })
  .limit(20);
assert(!error, 'Cannot inspect news readiness');
const symbol = analyzed?.find((a) => a.symbols.length)?.symbols[0] ?? 'DPR';
const response = await fetch(base + '/v1/news?symbol=' + symbol, {
  signal: AbortSignal.timeout(30000),
});
assert(response.ok, 'News API HTTP ' + response.status);
const news = (await response.json()) as {
  articles: ClassifiedArticle[];
  score: NewsScore;
  sources: { id: string; state: string }[];
};
assert(
  news.articles.length > 0 && news.sources.length === 4,
  'Real RSS/source data missing',
);
for (const a of news.articles) {
  assert(
    /^https:\/\/(cafef\.vn|vietstock\.vn|vneconomy\.vn|vnexpress\.net)\//.test(
      a.source_url,
    ),
    'Untrusted source URL',
  );
  if (a.analysis_status === 'ok')
    assert(validAnalysis(a.analysis, a), 'Unsupported model claim');
  else assert(a.analysis === null, 'Missing model data filled');
}
const classified = news.articles.filter((a) => a.analysis_status === 'ok');
if (process.env.NEWS_REQUIRE_LLM === '1')
  assert(
    classified.length > 0,
    'LLM NOT VERIFIED: configure Worker NEWS_LLM_API_KEY, NEWS_LLM_BASE_URL, NEWS_LLM_MODEL and run sync:news -- --production',
  );
console.log(
  `NEWS API PASS: ${symbol}, ${news.articles.length} real related/context articles, 4 sources, ${classified.length} validated LLM results; original links and missing data explicit`,
);
const browser = await chromium.launch({ headless: true });
let cleanup: (() => Promise<void>) | undefined;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  cleanup = await authenticateBrowser(page, base, '/stocks?symbol=' + symbol);
  await expect(page.getByTestId('stock-news')).toBeVisible({ timeout: 300000 });
  await expect(page.getByTestId('news-article').first()).toBeVisible({
    timeout: 60000,
  });
  for (const factor of ['macro', 'sector', 'corporate', 'foreign', 'liquidity'])
    await expect(page.getByTestId('factor-' + factor)).toBeVisible();
  const href = await page
    .getByTestId('news-article')
    .first()
    .getByRole('heading')
    .getByRole('link')
    .getAttribute('href');
  assert(
    news.articles.some((a) => a.source_url === href),
    'UI source link mismatch',
  );
  if (!classified.length)
    await expect(page.getByTestId('stock-news')).toContainText(
      'không đủ dữ liệu',
    );
  await mkdir('.cache/screenshots', { recursive: true });
  await page
    .getByTestId('stock-news')
    .screenshot({ path: '.cache/screenshots/phase6-news-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    '390px news overflow',
  );
  await page
    .getByTestId('stock-news')
    .screenshot({ path: '.cache/screenshots/phase6-news-mobile.png' });
  await page.goto(base + '/top10');
  await expect(page.getByTestId('ranking-day')).toBeVisible();
  const first = page.waitForResponse(
    (r) =>
      r.url().includes('/v1/rankings?') &&
      r.url().includes('horizon=day') &&
      r.url().includes('newsWeight=0.3'),
  );
  await page
    .getByLabel('Trọng số tâm lý tin tức (%)', { exact: true })
    .fill('30');
  const changed = await first;
  assert(changed.ok(), 'Rankings news weight HTTP failure');
  const result = (await changed.json()) as {
    newsWeight: number;
    data: {
      explanation: {
        coverage: number;
        rankingEligibility: { eligible: boolean };
      };
    }[];
    excluded: {
      explanation: {
        newsIntegration: { weight: number };
        strategies: { news: number | null };
      };
    }[];
  };
  assert(result.newsWeight === 0.3, 'Ranking weight ignored');
  assert(result.excluded.length > 0, 'Actual unranked evidence queue missing');
  assert(
    result.excluded.every(
      (r) =>
        r.explanation.newsIntegration.weight === 0.3 &&
        'news' in r.explanation.strategies,
    ),
    'News not integrated into rankings',
  );
  assert(
    result.data.every(
      (r) =>
        r.explanation.coverage === 1 &&
        r.explanation.rankingEligibility.eligible,
    ),
    'Partial data entered Top10',
  );
  await expect(page.getByTestId('ranking-day')).toContainText('Tâm lý tin tức');
  const zero = page.waitForResponse(
    (r) =>
      r.url().includes('/v1/rankings?') &&
      r.url().includes('horizon=day') &&
      r.url().includes('newsWeight=0'),
  );
  await page
    .getByLabel('Trọng số tâm lý tin tức (%)', { exact: true })
    .fill('0');
  assert((await zero).ok(), 'Zero news weight failed');
  assert(errors.length === 0, 'Browser JS errors: ' + errors.join('; '));
  console.log(
    'NEWS BROWSER PASS: original source links, 5 influence groups, 390px, Top10 news weight 30%/0%, strict eligibility preserved, no JS errors',
  );
  console.log(
    classified.length
      ? 'NEWS LLM LIVE PASS: real API classifications carry verbatim RSS evidence'
      : 'NEWS LLM NOT CONFIGURED: verified missing-data state; no sentiment or score invented',
  );
} finally {
  try {
    await browser.close();
  } finally {
    await cleanup?.();
  }
  console.log('NEWS CLEANUP PASS: temporary auth user removed');
}
