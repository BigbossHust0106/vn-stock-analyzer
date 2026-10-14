import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { authenticateBrowser } from './browser-auth';

// Uses an admin-confirmed temporary account; does not test SMTP or Google consent.
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
let cleanupAuth: (() => Promise<void>) | undefined;
try {
  await mkdir('.cache/screenshots', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  const featureRequests: string[] = [];
  let guest = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (
      guest &&
      /^\/v1\/(rankings|watchlists|stocks|financials|quotes)/.test(path)
    )
      featureRequests.push(path);
  });
  for (const path of [
    '/',
    '/top10',
    '/settings',
    '/watchlists',
    '/stocks?symbol=VNM',
  ]) {
    await page.goto(base + path);
    await expect(page).toHaveURL(
      base + '/login?next=' + encodeURIComponent(path),
    );
    await expect(page.locator('h1')).toHaveText('Chào mừngtrở lại.');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /Tra cứu mã|Top 10|Theo dõi|Cài đặt/ }),
    ).toHaveCount(0);
  }
  if (featureRequests.length) throw new Error('Guest mounted feature requests');
  console.log(
    'LOGIN GATE PASS: 5 direct routes redirect; no feature menu or feature API request before login',
  );
  await page.screenshot({
    path: '.cache/screenshots/login-desktop.png',
    fullPage: true,
  });
  await expect(page.locator('.login-illustration')).toBeVisible();
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error('Login horizontal overflow: ' + width);
    await expect(
      page.getByRole('button', { name: 'Đăng nhập', exact: true }),
    ).toBeVisible();
    if (width === 390)
      await page.screenshot({
        path: '.cache/screenshots/login-mobile.png',
        fullPage: true,
      });
  }
  await page.getByRole('button', { name: 'Đăng ký ngay', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Bắt đầu hành trình.');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute(
    'minlength',
    '8',
  );
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Gửi liên kết đặt lại' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByLabel('Mật khẩu', { exact: true }).fill('visibility-only');
  await page
    .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
    .click();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
  console.log(
    'LOGIN UI PASS: desktop, 360/390/768px; signup/reset modes; accessible password visibility control',
  );

  guest = false;
  cleanupAuth = await authenticateBrowser(page, base, '/stocks?symbol=VNM');
  await expect(page).toHaveURL(base + '/stocks?symbol=VNM');
  await expect(
    page.getByRole('navigation', { name: 'Chức năng chính' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Chức năng chính' }),
  ).toBeVisible();
  await page.goto(base + '/login');
  await expect(page).toHaveURL(base + '/watchlists');
  await expect(
    page.getByRole('navigation', { name: 'Chức năng chính' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(base + '/login?next=%2Fwatchlists');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  guest = true;
  featureRequests.length = 0;
  await page.goto(base + '/top10');
  await expect(page).toHaveURL(base + '/login?next=%2Ftop10');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  if (featureRequests.length) throw new Error('Feature fetched after logout');
  if (errors.length)
    throw new Error('Browser JavaScript error count: ' + errors.length);
  console.log(
    'LOGIN AUTH PASS: real email/password; stock destination preserved; session survives reload; signed-in login redirects; logout hides workspace; no JS errors',
  );
} finally {
  try {
    await browser.close();
  } finally {
    if (cleanupAuth) {
      await cleanupAuth();
      console.log(
        'LOGIN CLEANUP PASS: temporary user and private data deleted',
      );
    }
  }
}
