import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { authenticateBrowser, openAccountMenu } from './browser-auth';
import { parseVpsHistory } from '../modules/providers/market-schema';
import { parseVpsPayload } from '../modules/providers/vps-provider';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
let cleanup: (() => Promise<void>) | undefined;
try {
  await mkdir('.cache/screenshots', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [],
    requests: string[] = [],
    rankings: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const bars = parseVpsHistory(
    JSON.parse(await readFile('fixtures/phase2/VNM-history.json', 'utf8')),
    'VNM',
    new Date().toISOString(),
  );
  const quotes = JSON.parse(
    await readFile('fixtures/phase2/vps-quotes.json', 'utf8'),
  );
  const q = parseVpsPayload(quotes, new Date().toISOString()).find(
    (q) => q.symbol === 'VNM',
  )!;
  const last = bars.at(-1)!;
  const summary = {
    stock: {
      symbol: 'VNM',
      name: 'CTCP Sữa Việt Nam',
      exchange: 'HOSE',
      source: 'KBS',
    },
    quote: { ...q, lastPriceVnd: null },
    bars: [],
    notices: [],
    historySource: 'VPS',
    notice: 'Fixture kiểm thử giao diện, không dùng production.',
    displayPrice: {
      valueVnd: last.closeVnd,
      sessionDate: last.sessionDate,
      kind: 'close',
      source: 'VPS',
    },
  };
  await page.route('**/v1/stocks/VNM?*', async (route) => {
    const view = new URL(route.request().url()).searchParams.get('view')!;
    requests.push(view);
    await route.fulfill({
      json: { ...summary, bars: view === 'history' ? bars : [] },
    });
  });
  await page.route('**/v1/financials/VNM', (route) =>
    route.fulfill({ json: { financials: null, notices: [] } }),
  );
  await page.route('**/v1/rankings?*', async (route) => {
    rankings.push(new URL(route.request().url()).searchParams.get('horizon')!);
    await route.fulfill({
      json: { data: [], excluded: [], sectors: [], run: null },
    });
  });
  await page.goto(base + '/login');
  await expect(page.locator('.login-illustration')).toHaveJSProperty(
    'complete',
    true,
  );
  await expect
    .poll(() =>
      page
        .locator('.login-illustration')
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: '.cache/screenshots/pastel-login.png',
    fullPage: true,
  });
  cleanup = await authenticateBrowser(page, base, '/stocks?symbol=VNM');
  await expect(page.getByTestId('current-price')).toContainText(
    last.closeVnd.toLocaleString('vi-VN'),
  );
  await expect(page.getByTestId('display-price-label')).toContainText(
    'Đóng cửa phiên',
  );
  await expect(page.getByTestId('current-price')).not.toContainText('Chưa có');
  await expect(
    page.getByRole('checkbox', { name: 'Tự động tải biểu đồ nến' }),
  ).not.toBeChecked();
  expect(requests).toEqual(['summary']);
  await expect(page.getByTestId('price-chart')).toHaveCount(0);
  await page.screenshot({
    path: '.cache/screenshots/pastel-stock-fast.png',
    fullPage: true,
  });
  await page.getByRole('checkbox', { name: 'Tự động tải biểu đồ nến' }).check();
  await expect(
    page.getByTestId('price-chart').locator('canvas').first(),
  ).toBeVisible();
  expect(requests.filter((r) => r === 'history')).toHaveLength(1);
  await page
    .getByRole('checkbox', { name: 'Tự động tải biểu đồ nến' })
    .uncheck();
  await expect(page.getByTestId('price-chart')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('current-price')).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Tự động tải biểu đồ nến' }),
  ).not.toBeChecked();
  expect(requests.filter((r) => r === 'history')).toHaveLength(1);
  console.log(
    'REFRESH UI PASS: previous close with date, no history/chart on initial load, lazy chart on/off and remembered opt-out',
  );
  await openAccountMenu(page);
  await expect(
    page.getByRole('navigation', { name: 'Quản lý tài khoản' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Quản lý tài khoản' })
      .getByRole('link', { name: 'Đổi mật khẩu' }),
  ).toBeVisible();
  await page.screenshot({ path: '.cache/screenshots/pastel-account-menu.png' });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('navigation', { name: 'Quản lý tài khoản' }),
  ).toHaveCount(0);
  for (const path of ['/', '/settings', '/watchlists', '/top10']) {
    await page.goto(base + path);
    await expect(
      page.getByRole('button', { name: 'Menu tài khoản' }),
    ).toBeVisible();
    await page.screenshot({
      path: '.cache/screenshots/pastel-' + (path.slice(1) || 'home') + '.png',
      fullPage: true,
    });
  }
  await expect(page.getByTestId('ranking-day')).toBeVisible();
  expect(rankings).toEqual(['day']);
  await page.getByLabel('Kỳ xếp hạng', { exact: true }).selectOption('month');
  await expect(page.getByTestId('ranking-month')).toBeVisible();
  await expect.poll(() => rankings.at(-1)).toBe('month');
  await expect(page.getByTestId('ranking-day')).toHaveCount(0);
  await page.getByLabel('Kỳ xếp hạng', { exact: true }).selectOption('quarter');
  await expect(page.getByTestId('ranking-quarter')).toBeVisible();
  await expect.poll(() => rankings.at(-1)).toBe('quarter');
  expect(rankings).toEqual(['day', 'month', 'quarter']);
  await page.getByRole('button', { name: 'Chuyển sang chế độ tối' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: '.cache/screenshots/pastel-top10-dark.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Chuyển sang chế độ sáng' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    '/',
    '/stocks?symbol=VNM',
    '/top10',
    '/watchlists',
    '/settings',
  ]) {
    await page.goto(base + path);
    await expect(
      page.getByRole('button', { name: 'Menu tài khoản' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path:
        '.cache/screenshots/pastel-mobile-' +
        (new URL(path, base).pathname.slice(1) || 'home') +
        '.png',
      fullPage: true,
    });
  }
  await openAccountMenu(page);
  await page
    .getByRole('navigation', { name: 'Quản lý tài khoản' })
    .getByRole('button', { name: 'Đăng xuất', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?/);
  expect(errors).toEqual([]);
  console.log(
    'REFRESH UI PASS: real Auth/avatar menu/Escape/logout; one selected ranking horizon/request at a time; five pages at390px without overflow or JS errors',
  );
} finally {
  await browser.close();
  if (cleanup) await cleanup();
}
