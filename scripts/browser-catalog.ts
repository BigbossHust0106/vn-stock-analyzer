import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const config = (await (await fetch(base + '/v1/public-config')).json()) as {
  supabaseUrl: string;
};
const user = {
  id: '99000000-0000-4000-8000-000000000099',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'ui-fixture@example.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-10-22T00:00:00Z',
};
const expiration = Math.floor(Date.now() / 1000) + 3600;
const token =
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  ) +
  '.' +
  Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      aud: user.aud,
      exp: expiration,
    }),
  ).toString('base64url') +
  '.fixture';
const browser = await chromium.launch({ headless: true });
let stage = 'startup';
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // UI-only Auth fixture: no real sign-in, user creation, private writes or RLS claim.
  // Catalog/public financial API calls continue through the real Worker and DB.
  await context.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    {
      key:
        'sb-' +
        new URL(config.supabaseUrl).hostname.split('.')[0] +
        '-auth-token',
      session: {
        access_token: token,
        refresh_token: 'fixture-only',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiration,
        user,
      },
    },
  );
  await page.route('**/auth/v1/user', (r) => r.fulfill({ json: user }));
  await page.route('**/rest/v1/user_settings*', (r) => r.fulfill({ json: [] }));
  stage = 'available list';
  await page.goto(base + '/');
  const section = page.getByTestId('data-priority');
  await expect(
    section.getByRole('heading', { name: 'Tra cứu toàn bộ mã chứng khoán' }),
  ).toBeVisible({ timeout: 45000 });
  await expect(section.locator('.data-priority-card')).toHaveCount(24, {
    timeout: 45000,
  });
  await expect(section.getByTestId('catalog-counts')).toContainText(
    'mã trong danh mục',
  );
  const a = await section.locator('.data-priority-card').first().innerText();
  await section.getByRole('button', { name: 'Trang sau →' }).click();
  await expect(section.locator('.data-priority-card').first()).toBeVisible({
    timeout: 30000,
  });
  expect(
    await section.locator('.data-priority-card').first().innerText(),
  ).not.toBe(a);
  stage = 'full market';
  await section.getByLabel('Dữ liệu BCTC', { exact: true }).selectOption('all');
  await expect(section.locator('.data-priority-card')).toHaveCount(24, {
    timeout: 30000,
  });
  stage = 'HNX filter';
  await section.getByLabel('Sàn', { exact: true }).selectOption('HNX');
  await expect(section.locator('.data-priority-card')).toHaveCount(24, {
    timeout: 30000,
  });
  for (const card of await section
    .locator('.data-priority-card h3')
    .allTextContents())
    expect(card).toContain('HNX');
  stage = 'new symbol';
  await section.getByLabel('Sàn', { exact: true }).selectOption('');
  await section.getByLabel('Tìm trong danh mục', { exact: true }).fill('FRT');
  await expect(section.locator('.data-priority-card')).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(section.locator('.data-priority-card h3')).toContainText('FRT');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({
    path: '.cache/screenshots/catalog-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await section.getByLabel('Tìm trong danh mục', { exact: true }).fill('');
  await expect(section.locator('.data-priority-card')).toHaveCount(24, {
    timeout: 30000,
  });
  await page.screenshot({
    path: '.cache/screenshots/catalog-desktop.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    'CATALOG BROWSER PASS: real public Worker/DB; 24 available cards, page2 differs, all-market/HNX filter, FRT search, 390/1440px, no JS errors. Auth is a UI fixture; no real Auth/RLS verification claimed.',
  );
  await context.close();
} catch (error) {
  console.error(
    'CATALOG BROWSER FAIL at',
    stage,
    '(page/credentials omitted)',
    error instanceof Error
      ? error.message.split('\n')[0]?.slice(0, 160)
      : 'unknown',
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
