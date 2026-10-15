import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { authenticateBrowser } from './browser-auth';
const base = process.env.MARKET_APP_URL ?? 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
let cleanup: (() => Promise<void>) | undefined;
try {
  await mkdir('.cache/screenshots', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  const scopes: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const vnm = {
    symbol: 'VNM',
    name: 'CTCP Sữa Việt Nam',
    exchange: 'HOSE',
    source: 'KBS',
    coverage: 0.75,
    graham_coverage: 0.9,
    buffett_coverage: 0.6,
    annual_years: 4,
    latest_year: 2025,
  };
  const fpt = {
    ...vnm,
    symbol: 'FPT',
    name: 'CTCP FPT',
    coverage: 0.3,
    graham_coverage: 0.2,
    buffett_coverage: 0.4,
  };
  await page.route('**/v1/stocks?*', (r) =>
    r.fulfill({ json: { data: [vnm, fpt] } }),
  );
  await page.route('**/v1/stocks/*?*', (r) => {
    const symbol = new URL(r.request().url()).pathname.split('/').at(-1)!;
    return r.fulfill({
      json: {
        stock: symbol === 'FPT' ? fpt : vnm,
        quote: null,
        bars: [],
        notices: [],
        historySource: 'VPS',
        notice: 'Dữ liệu fixture kiểm thử UI',
        displayPrice: {
          kind: 'close',
          valueVnd: 58000,
          sessionDate: '2026-10-14',
          source: 'VPS',
        },
      },
    });
  });
  await page.route('**/v1/financials/*', (r) =>
    r.fulfill({ json: { financials: null, notices: [], backups: [] } }),
  );
  const direct = {
    id: 'direct',
    source_id: 'cafef',
    source_url: 'https://cafef.vn/vnm-test.chn',
    title: 'VNM công bố báo cáo tài chính',
    excerpt: 'Doanh thu VNM cập nhật',
    published_at: '2026-10-15T01:00:00Z',
    symbols: ['VNM'],
    sectors: ['Sữa'],
    factors: ['corporate'],
    macro_topics: [],
    analysis: null,
  };
  const context = {
    ...direct,
    id: 'context',
    title: 'Bối cảnh lãi suất thị trường',
    symbols: [],
    sectors: [],
    factors: ['macro'],
  };
  await page.route('**/v1/news?*', (r) => {
    const u = new URL(r.request().url());
    scopes.push(u.searchParams.get('scope') ?? 'stock');
    return r.fulfill({
      json: {
        symbol: u.searchParams.get('symbol'),
        sector: 'Sữa',
        articles:
          u.searchParams.get('scope') === 'context'
            ? [direct, context]
            : [direct],
        sources: [],
        status: null,
        score: {
          score: null,
          count: 0,
          sourceCount: 0,
          reason: 'Chưa phân tích LLM',
        },
        scope: 'Fixture UI',
      },
    });
  });
  cleanup = await authenticateBrowser(page, base, '/settings');
  const search = page.getByRole('combobox', {
    name: 'Tìm mã hoặc tên công ty',
  });
  await search.fill('FPT');
  await expect(
    page.locator('#stock-suggestions a').filter({ hasText: 'FPT' }),
  ).toBeVisible();
  await expect(page).toHaveURL(base + '/settings');
  await search.press('Escape');
  await expect(page.locator('#stock-suggestions')).toHaveCount(0);
  await search.fill('FPT');
  await expect(
    page.locator('#stock-suggestions a').filter({ hasText: 'FPT' }),
  ).toBeVisible();
  await page.locator('#stock-suggestions a').filter({ hasText: 'FPT' }).click();
  await expect(page).toHaveURL(base + '/stocks?symbol=FPT');
  await search.fill('VNM');
  await search.press('Enter');
  await expect(page).toHaveURL(base + '/stocks?symbol=VNM');
  const news = page.getByTestId('stock-news');
  await expect(news.getByTestId('factor-corporate')).toContainText(
    'VNM công bố',
  );
  const expanded = page.getByTestId('news-expanded');
  await expect(expanded).not.toHaveAttribute('open');
  await expect(news.getByTestId('news-article')).toBeHidden();
  await expect(news.getByTestId('factor-macro')).not.toContainText(
    'Bối cảnh lãi suất',
  );
  await expanded.locator('summary').first().click();
  await expect(news.getByTestId('news-article')).toBeVisible();
  expect(scopes.at(-1)).toBe('stock');
  await news
    .getByRole('button', { name: 'Bối cảnh ngành / thị trường' })
    .click();
  await expect.poll(() => scopes.at(-1)).toBe('context');
  await expect(news.getByTestId('news-article')).toContainText(
    'Bối cảnh lãi suất',
  );
  await expect(news.getByTestId('factor-macro')).not.toContainText(
    'Bối cảnh lãi suất',
  );
  await news.screenshot({ path: '.cache/screenshots/focus-news-expanded.png' });
  await expanded.locator('summary').first().click();
  await news.screenshot({ path: '.cache/screenshots/focus-news-compact.png' });
  await page.goto(base + '/');
  await expect(page.getByTestId('data-priority')).toContainText(
    'Graham 90% · Buffett 60%',
  );
  await page.screenshot({
    path: '.cache/screenshots/focus-home.png',
    fullPage: true,
  });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [
      '/',
      '/settings',
      '/stocks?symbol=VNM',
      '/watchlists',
      '/top10',
    ]) {
      await page.goto(base + path);
      await expect(search).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill('VNM');
  await expect(
    page.locator('#stock-suggestions a').filter({ hasText: 'VNM' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.cache/screenshots/focus-header-mobile.png' });
  expect(errors).toEqual([]);
  console.log(
    'FOCUS UI PASS: real Auth; header search from settings without leaving route, suggestions/Escape/Enter; stock-specific factors, collapsed articles and explicit context opt-in; both coverage badges; five routes at390/768px without overflow/JS errors (market/news fixtures).',
  );
} finally {
  try {
    await browser.close();
  } finally {
    await cleanup?.();
  }
}
