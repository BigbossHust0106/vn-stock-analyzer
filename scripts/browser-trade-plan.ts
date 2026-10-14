import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { authenticateBrowser } from './browser-auth';
import type { StockDetail } from '../web/lib/market-client';
import type { FinancialData } from '../modules/providers/financial-types';
import { buildTradePlan } from '../modules/trading/trade-plan';
import { defaultTradeSettings } from '../modules/settings/trade-plan-settings';
import { tickSize } from '../modules/trading/exchange-rules';
import { vietnamDate } from '../modules/market/calendar';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
const cleanups: (() => Promise<void>)[] = [];
function assert(v: unknown, msg: string): asserts v {
  if (!v) throw Error(msg);
}
async function ready(page: Page) {
  await expect(page.getByTestId('trade-plan')).toBeVisible({ timeout: 300000 });
  await expect(page.getByTestId('comparison-status')).toBeVisible({
    timeout: 300000,
  });
  await expect(page.getByTestId('trade-plan').locator('tbody tr')).toHaveCount(
    8,
  );
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let detail: StockDetail | undefined, financials: FinancialData | undefined;
  page.on('response', async (response) => {
    if (!response.ok()) return;
    if (/\/v1\/stocks\/DPR$/.test(response.url()))
      detail = (await response.json()) as StockDetail;
    if (/\/v1\/financials\/DPR$/.test(response.url()))
      financials = ((await response.json()) as { financials: FinancialData })
        .financials;
  });
  cleanups.push(await authenticateBrowser(page, base, '/stocks?symbol=DPR'));
  await ready(page);
  await expect.poll(() => Boolean(detail && financials)).toBe(true);
  assert(detail && financials, 'Actual DPR responses missing');
  const plan = buildTradePlan({
    symbol: 'DPR',
    exchange: detail.stock.exchange,
    bars: detail.bars,
    financials,
    priceVnd: detail.quote?.lastPriceVnd ?? null,
    referenceVnd: detail.quote?.referenceVnd ?? null,
    floorVnd: detail.quote?.floorVnd ?? null,
    ceilingVnd: detail.quote?.ceilingVnd ?? null,
    asOf: new Date().toISOString(),
    settings: { ...defaultTradeSettings },
  });
  for (const l of plan.levels) {
    const row = page.getByTestId('plan-' + l.id);
    await expect(row).toHaveAttribute(
      'data-price',
      l.price === null ? '' : String(l.price),
    );
    if (l.price !== null) {
      assert(
        l.price % tickSize(l.price, detail.stock.exchange) === 0,
        'Wrong VN tick: ' + l.id,
      );
      await expect(page.locator(`[data-level="${l.id}"]`)).toContainText(
        l.price.toLocaleString('vi-VN'),
      );
    }
    if (l.rr !== null) assert(l.rr >= 2, 'TP R:R under 2 after rounding');
  }
  await expect(page.getByTestId('trade-plan')).toContainText(
    'Kịch bản tham khảo',
  );
  await expect(
    page.getByTestId('price-chart').locator('canvas').first(),
  ).toBeVisible();
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({
    path: '.cache/screenshots/phase5-desktop.png',
    fullPage: true,
  });
  console.log(
    `TRADE PLAN DATA PASS: DPR ${detail.bars.length} real daily bars; 8 explained levels match engine; VN ticks and R:R >=2; missing methods disclosed`,
  );
  await page
    .getByLabel('Phương pháp cắt lỗ', { exact: true })
    .selectOption('percent');
  await page
    .getByLabel('Giá vào kế hoạch (VND)', { exact: true })
    .fill('40000');
  await page.getByLabel('Lỗ tối đa (%)', { exact: true }).fill('5');
  await expect(page.getByTestId('plan-stop')).toHaveAttribute(
    'data-price',
    '38000',
  );
  const yesterday = vietnamDate(Date.now() - 86400000);
  await page.getByLabel('Ngày mở vị thế', { exact: true }).fill(yesterday);
  await page.getByLabel('Bật trailing stop', { exact: true }).check();
  await expect(page.getByTestId('plan-trailing')).not.toHaveAttribute(
    'data-price',
    '',
  );
  const trailing = Number(
    await page.getByTestId('plan-trailing').getAttribute('data-price'),
  );
  await page.reload();
  await ready(page);
  await expect(page.getByLabel('Lỗ tối đa (%)', { exact: true })).toHaveValue(
    '5',
  );
  await expect(page.getByLabel('Ngày mở vị thế', { exact: true })).toHaveValue(
    yesterday,
  );
  await expect
    .poll(async () =>
      Number(
        await page.getByTestId('plan-trailing').getAttribute('data-price'),
      ),
    )
    .toBeGreaterThanOrEqual(trailing);
  await page.getByRole('button', { name: 'Tuần', exact: true }).click();
  await page.getByRole('button', { name: '3T', exact: true }).click();
  await expect(page.locator('[data-level="stop"]')).toContainText('38.000');
  await page
    .getByLabel('Hiện vùng tham khảo trên biểu đồ', { exact: true })
    .uncheck();
  await expect(page.getByTestId('chart-plan-levels')).toHaveCount(0);
  await page
    .getByLabel('Hiện vùng tham khảo trên biểu đồ', { exact: true })
    .check();
  await expect(page.getByTestId('chart-plan-levels')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    '390px horizontal page overflow',
  );
  await page.screenshot({
    path: '.cache/screenshots/phase5-mobile.png',
    fullPage: true,
  });
  console.log(
    'TRADE PLAN UI PASS: percent stop 40000*(1-5%)=38000; trailing persists without decreasing; chart frame/range and toggle; 390px without overflow',
  );
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Đăng nhập', exact: true }),
  ).toBeVisible();
  cleanups.push(await authenticateBrowser(page, base, '/stocks?symbol=DPR'));
  await ready(page);
  await expect(page.getByLabel('Lỗ tối đa (%)', { exact: true })).toHaveValue(
    '8',
  );
  await expect(
    page.getByLabel('Giá vào kế hoạch (VND)', { exact: true }),
  ).toHaveValue('');
  await expect(
    page.getByLabel('Bật trailing stop', { exact: true }),
  ).not.toBeChecked();
  assert(errors.length === 0, 'Browser JS errors: ' + errors.join('; '));
  console.log(
    'TRADE PLAN ISOLATION PASS: same browser, second user has defaults; no JavaScript errors',
  );
} finally {
  try {
    await browser.close();
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
  console.log('TRADE PLAN CLEANUP PASS: temporary auth users removed');
}
