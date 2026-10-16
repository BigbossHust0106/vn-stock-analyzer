import { chromium, expect } from '@playwright/test';
import { authenticateBrowser } from './browser-auth';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
let cleanup: (() => Promise<void>) | undefined;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Deliberately hostile legacy response: 23 qualified + 23 unqualified. These are UI fixtures, never production writes.
  const data = Array.from({ length: 23 }, (_, i) => ({
    stock_id: 'ui-' + i,
    symbol: 'S' + String(i).padStart(2, '0'),
    name: 'Doanh nghiệp kiểm thử ' + i,
    exchange: 'HOSE',
    sector: 'Kiểm thử',
    position: i + 1,
    as_of: '2026-10-16',
    computed_at: '2026-10-16T03:00:00Z',
    score: 90 - i,
    price_vnd: 20000,
    reference_vnd: 20000,
    quote_fetched_at: '2026-10-16T03:00:00Z',
    explanation: {
      coverage: 1,
      confidence: 65,
      strategies: { graham: 80, buffett: 70 },
      reasons: ['Dữ liệu kiểm thử UI, không phải khuyến nghị.'],
      marketCapVnd: 1e12,
    },
  }));
  let price = 21000,
    quoteCalls = 0,
    fail = false;
  await page.route('**/v1/rankings?*', (route) =>
    route.fulfill({
      json: {
        data,
        excluded: data,
        sectors: ['Kiểm thử'],
        run: { computed_at: '2026-10-16T03:00:00Z', universe_count: 23 },
      },
    }),
  );
  await page.route('**/v1/quotes?*', (route) => {
    quoteCalls++;
    return fail
      ? route.fulfill({
          status: 503,
          json: { error: 'Nguồn kiểm thử gián đoạn' },
        })
      : route.fulfill({
          json: {
            data: data.slice(0, 10).map((row) => ({
              symbol: row.symbol,
              prices_current: {
                last_price_vnd: price,
                reference_vnd: 20000,
                fetched_at:
                  price === 21000
                    ? '2026-10-16T03:01:00Z'
                    : '2026-10-16T03:02:00Z',
              },
            })),
            refresh: { state: 'source_response' },
          },
        });
  });
  cleanup = await authenticateBrowser(page, base, '/top10');
  for (const horizon of ['day', 'month', 'quarter']) {
    await page.getByLabel('Kỳ xếp hạng', { exact: true }).selectOption(horizon);
    await expect(page.getByTestId('ranking-' + horizon)).toBeVisible();
    await expect(
      page.getByTestId('top10-table').locator('tbody tr'),
    ).toHaveCount(10);
    await expect(page.locator('[data-testid^="unranked-"]')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'S10', exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByTestId('top10-table').locator('tbody tr').first(),
  ).toContainText('21.000 đ');
  await expect(
    page.getByTestId('top10-table').locator('tbody tr').first(),
  ).toContainText('+5,00%'); // (21000/20000-1)*100 =5%.
  price = 22000;
  await expect(
    page.getByTestId('top10-table').locator('tbody tr').first(),
  ).toContainText('22.000 đ', { timeout: 25000 });
  await expect(
    page.getByTestId('top10-table').locator('tbody tr').first(),
  ).toContainText('+10,00%'); // (22000/20000-1)*100 =10%.
  const first = page.getByTestId('top10-table').locator('tbody tr').first();
  await expect(first).toContainText('90,0'); // Original score unchanged when only price refreshed.
  fail = true;
  await expect(page.getByTestId('ranking-live-status')).toContainText(
    'giữ dữ liệu cũ',
    { timeout: 25000 },
  );
  await expect(first).toContainText('22.000 đ');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId('top10-table').locator('tbody tr')).toHaveCount(
    10,
  );
  expect(errors).toEqual([]);
  expect(quoteCalls).toBeGreaterThanOrEqual(3);
  console.log(
    'TOP10 BROWSER PASS: all three horizons capped at10 unique rows despite23+23 fixture; excluded table absent; mobile390/desktop1440; no JS errors.',
  );
  console.log(
    'PRICE POLLING BROWSER PASS: independently expected21000/+5% to22000/+10% without reload; score90 unchanged; upstream failure retains22000 and warns; no physical exchange tick claimed.',
  );
} finally {
  await browser.close();
  await cleanup?.();
}
