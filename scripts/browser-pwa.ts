import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { authenticateBrowser, openAccountMenu } from './browser-auth';
const base = process.env.MARKET_APP_URL ?? 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
let cleanup: (() => Promise<void>) | undefined;
try {
  await mkdir('.cache/screenshots', { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/install');
  await expect(page.getByTestId('install-app')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'iPhone / iPad · Safari' }),
  ).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute('content', 'yes');
  const response = await context.request.get(base + '/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('manifest');
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    display: 'standalone',
    scope: '/',
    start_url: '/?source=pwa',
  });
  for (const icon of manifest.icons) {
    const r = await context.request.get(base + icon.src);
    expect(r.ok()).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const cacheUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      if (name.startsWith('vn-stock-pwa-')) {
        const c = await caches.open(name);
        urls.push(...(await c.keys()).map((r) => new URL(r.url).pathname));
      }
    return urls.sort();
  });
  expect(cacheUrls).toEqual([
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/offline.html',
  ]);
  // A synthetic browser event checks our UI; this does not install into Android or iOS.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(e, {
      prompt: { value: Promise.resolve.bind(Promise) },
      userChoice: {
        value: Promise.resolve({ outcome: 'dismissed', platform: 'test' }),
      },
    });
    window.dispatchEvent(e);
  });
  await page.getByRole('button', { name: 'Cài VN Stock', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Bạn có thể cài lại');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.cache/screenshots/pwa-install-mobile.png',
    fullPage: true,
  });
  await context.setOffline(true);
  const api = await page.evaluate(async () => {
    try {
      await fetch('/v1/watchlists');
      return 'cached';
    } catch {
      return 'network-required';
    }
  });
  expect(api).toBe('network-required');
  await page.goto(base + '/watchlists');
  await expect(
    page.getByRole('heading', { name: 'Bạn đang ngoại tuyến' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    'Đang kiểm tra đăng nhập',
  );
  await page.screenshot({
    path: '.cache/screenshots/pwa-offline.png',
    fullPage: true,
  });
  await context.setOffline(false);
  await page.goto(base + '/?source=pwa');
  await expect(page).toHaveURL(
    base + '/login?next=' + encodeURIComponent('/?source=pwa'),
  );
  await expect(
    page.getByRole('link', { name: 'Cài VN Stock trên điện thoại' }),
  ).toHaveAttribute('href', '/install');
  cleanup = await authenticateBrowser(page, base, '/watchlists');
  const nav = page.getByRole('navigation', { name: 'Điều hướng điện thoại' });
  await expect(nav).toBeVisible();
  await expect(page.getByRole('link', { name: /^Cảnh báo,/ })).toBeVisible();
  await nav.getByRole('button', { name: 'Tìm mã' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Tìm mã hoặc tên công ty' }),
  ).toBeFocused();
  await nav.getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await expect(page).toHaveURL(base + '/settings');
  await expect(
    nav.getByRole('link', { name: 'Cài đặt', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.screenshot({
    path: '.cache/screenshots/pwa-workspace-mobile.png',
    fullPage: true,
  });
  await context.setOffline(true);
  await expect(
    page.getByRole('status').filter({ hasText: 'Bạn đang ngoại tuyến' }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole('status').filter({ hasText: 'Bạn đang ngoại tuyến' }),
  ).toHaveCount(0);
  await openAccountMenu(page);
  await page
    .getByRole('navigation', { name: 'Quản lý tài khoản' })
    .getByRole('link', { name: 'Cài ứng dụng điện thoại' })
    .click();
  await expect(page).toHaveURL(base + '/install');
  const afterAuth = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      if (name.startsWith('vn-stock-pwa-')) {
        const c = await caches.open(name);
        urls.push(...(await c.keys()).map((r) => new URL(r.url).pathname));
      }
    return urls.sort();
  });
  expect(afterAuth).toEqual(cacheUrls);
  expect(errors).toEqual([]);
  console.log(
    'PWA BROWSER PASS: HTTPS/localhost manifest and PNGs, iOS metadata, SW controls page, CacheStorage contains public offline assets only, offline API requires network, navigation shows offline fallback, install prompt UI (synthetic dismissal).',
  );
  console.log(
    'PWA MOBILE PASS: real Supabase Auth, bottom navigation/search focus/settings, offline/online banner, install menu, 390px without overflow or JS errors. Physical Android/iPhone installation not performed.',
  );
} finally {
  try {
    await browser.close();
  } finally {
    await cleanup?.();
  }
}
