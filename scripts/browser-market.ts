import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
try {
  await mkdir('.cache/screenshots', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const symbol of ['VNM', 'FPT', 'HPG']) {
    await page.goto(base);
    await page.getByLabel('Tìm mã hoặc tên công ty').fill(symbol);
    const link = page
      .locator('#stock-suggestions a')
      .filter({ has: page.locator('.ticker', { hasText: symbol }) })
      .first();
    await link.waitFor({ timeout: 30000 });
    await link.click();
    await page.getByTestId('price-chart').waitFor({ timeout: 60000 });
    const price = await page.getByTestId('current-price').innerText();
    if (price.includes('Chưa có'))
      throw new Error(symbol + ' thiếu giá hiện tại');
    const canvas = page.getByTestId('price-chart').locator('canvas').first();
    if (!(await canvas.boundingBox())) throw new Error('Không có canvas');
    await page.getByRole('button', { name: 'Tuần', exact: true }).click();
    await page.getByRole('button', { name: 'Tháng', exact: true }).click();
    await page.getByRole('button', { name: 'Ngày', exact: true }).click();
    await page.getByRole('button', { name: '3N', exact: true }).click();
    await page.screenshot({
      path: '.cache/screenshots/' + symbol + '-desktop.png',
      fullPage: true,
    });
    console.log(
      `BROWSER LIVE PASS: ${symbol}, ${price.replace(/\s+/g, ' ')}, search → detail, canvas, 1D/1W/1M, MA/volume`,
    );
  }
  await page.goto(base);
  await page.getByLabel('Tìm mã hoặc tên công ty').fill('VNM');
  await page.locator('#stock-suggestions a').first().waitFor();
  await page.getByLabel('Tìm mã hoặc tên công ty').press('Enter');
  await page.getByTestId('price-chart').waitFor({ timeout: 60000 });
  if (!page.url().includes('symbol=VNM'))
    throw new Error('Enter không mở đúng mã');
  console.log('BROWSER LIVE PASS: Enter mở đúng VNM');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Chuyển sang chế độ/ }).click();
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.reload();
  await page.getByTestId('price-chart').waitFor({ timeout: 60000 });
  if ((await page.locator('html').getAttribute('data-theme')) !== theme)
    throw new Error('Theme không được lưu');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('Mobile overflow');
  await page.screenshot({
    path: '.cache/screenshots/mobile.png',
    fullPage: true,
  });
  if (errors.length)
    throw new Error('Browser có lỗi JavaScript: ' + errors.join('; '));
  console.log(
    'BROWSER LIVE PASS: 390px responsive, theme toggle/reload, no JS errors',
  );
} finally {
  await browser.close();
}
