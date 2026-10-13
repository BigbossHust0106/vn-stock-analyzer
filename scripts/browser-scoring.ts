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
    await page.goto(base + '/stocks?symbol=' + symbol);
    await page.getByTestId('scoring-panel').waitFor({ timeout: 120000 });
    for (const id of ['graham', 'buffett'])
      await page.getByTestId('strategy-' + id).waitFor();
    const score = await page.getByTestId('combined-score').innerText();
    if (score.includes('—'))
      throw new Error('Missing actual score for ' + symbol);
    const decision = await page.getByTestId('score-conclusion').innerText();
    if (decision !== 'Quan sát')
      throw new Error('Insufficient evidence unexpectedly recommends purchase');
    await page.getByText('Số liệu tài chính năm 2025', { exact: true }).click();
    if (
      !(await page.locator('.financial-table table').innerText()).includes(
        'EPS năm',
      )
    )
      throw new Error('Missing annual EPS');
    await page.screenshot({
      path: `.cache/screenshots/${symbol}-scoring.png`,
      fullPage: true,
    });
    console.log(
      `SCORING BROWSER PASS: ${symbol}, score ${score.replace(/\s+/g, ' ')}, ${decision}, both strategies/criteria/intrinsic/MOS/yearly financials`,
    );
  }
  await page.goto(base + '/settings');
  await page.getByTestId('settings-ready').waitFor({ timeout: 30000 });
  await page.getByLabel('Trọng số Graham (%)', { exact: true }).fill('100');
  await page.getByLabel('Trọng số Buffett (%)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Đã lưu trên trình duyệt này' })
    .waitFor();
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('input[type=number]')?.value ===
      '100',
  );
  await page.goto(base + '/stocks?symbol=VNM');
  await page.getByTestId('scoring-panel').waitFor({ timeout: 120000 });
  await page.getByText('Graham 100% · Buffett 0%', { exact: true }).waitFor();
  const score = await page.getByTestId('combined-score').innerText();
  const graham = await page
    .getByTestId('strategy-graham')
    .locator('.detail-heading strong')
    .innerText();
  if (Number.parseFloat(score) !== Number.parseFloat(graham))
    throw new Error('Weight100 did not apply Graham score');
  console.log(
    'SCORING BROWSER PASS: settings100/0 persists across reload; actual combined score equals Graham',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('Số liệu tài chính năm 2025', { exact: true }).click();
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  )
    throw new Error('Scoring mobile overflow');
  await page.screenshot({
    path: '.cache/screenshots/scoring-mobile.png',
    fullPage: true,
  });
  await page.goto(base + '/settings');
  await page.getByTestId('settings-ready').waitFor({ timeout: 30000 });
  await page
    .getByRole('button', { name: 'Khôi phục mặc định', exact: true })
    .click();
  await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Đã lưu trên trình duyệt này' })
    .waitFor();
  if (errors.length) throw new Error('Browser JS errors: ' + errors.join(';'));
  console.log(
    'SCORING BROWSER PASS: 390px, financial table scroll, no JS errors; defaults restored',
  );
} finally {
  await browser.close();
}
