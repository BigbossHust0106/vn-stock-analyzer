import { chromium, expect } from '@playwright/test';
import { authenticateBrowser } from './browser-auth';
const base = process.env.MARKET_APP_URL ?? 'http://127.0.0.1:8878';
const browser = await chromium.launch({ headless: true });
let stage = 'Auth';
let cleanup: (() => Promise<void>) | undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let historyCalls = 0;
  page.on('request', (req) => {
    if (req.url().includes('view=history')) historyCalls++;
  });
  cleanup = await authenticateBrowser(page, base, '/stocks?symbol=FPT');
  stage = 'export button visible';
  await expect(
    page.getByRole('button', {
      name: 'Kiểm chứng bằng ChatGPT ↗',
      exact: true,
    }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('scoring-panel')).toBeVisible({
    timeout: 60000,
  });
  const displayedConclusion = await page
    .getByTestId('score-conclusion')
    .innerText();
  const displayedScore = (await page.getByTestId('combined-score').innerText())
    .replace(/\s+/g, ' ')
    .trim();
  stage = 'history not eagerly loaded';
  expect(historyCalls).toBe(0); // Off by default: export must not eagerly load history.
  await page.evaluate(`(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value) => { document.documentElement.dataset.auditClipboard = value; }
    }});
    window.open = (url) => { document.documentElement.dataset.auditTarget = String(url); return null; };
  })()`);
  await page
    .getByRole('button', { name: 'Kiểm chứng bằng ChatGPT ↗', exact: true })
    .click();
  stage = 'collect public data';
  const output = page.getByLabel(/Toàn bộ dữ liệu & yêu cầu kiểm chứng/);
  await expect(output).toBeVisible({ timeout: 45000 });
  stage = 'payload assertions';
  const text = await output.inputValue();
  expect(text).toContain('BEGIN_STOCK_DATA');
  const snapshot = JSON.parse(
    text.split('BEGIN_STOCK_DATA\n')[1]!.split('\nEND_STOCK_DATA')[0]!,
  );
  expect(snapshot.symbol).toBe('FPT');
  expect(snapshot.websiteAssessment.origin).toBe('displayed_on_page');
  expect(snapshot.websiteAssessment.report.conclusion).toBe(
    displayedConclusion,
  );
  expect(displayedScore).toBe(
    `${snapshot.websiteAssessment.report.score ?? '—'} / 100`,
  );
  expect(text).toContain('BEGIN_WEBSITE_ASSESSMENT');
  expect(text).toContain('Kết luận: ' + displayedConclusion);
  for (const strategy of snapshot.websiteAssessment.report.strategies) {
    for (const criterion of strategy.criteria)
      expect(text).toContain(criterion.explanation);
  }
  for (const risk of snapshot.websiteAssessment.report.risks)
    expect(text).toContain(risk);
  expect(snapshot.history.bars.length).toBeGreaterThan(20);
  expect(snapshot.financials.financials.symbol).toBe('FPT');
  expect(snapshot.financials.financials.annual.length).toBeGreaterThan(0);
  expect(snapshot.market.stock.symbol).toBe('FPT');
  expect(snapshot.technicals.ma20.length).toBeGreaterThan(0);
  expect(historyCalls).toBeGreaterThan(0);
  expect(text).not.toMatch(/access_token|refresh_token|sb_secret_|owner_id/);
  await page
    .getByRole('button', { name: 'Sao chép & mở ChatGPT ↗', exact: true })
    .click();
  expect(
    await page.evaluate(() => document.documentElement.dataset.auditClipboard),
  ).toBe(text);
  expect(
    await page.evaluate(() => document.documentElement.dataset.auditTarget),
  ).toBe('https://chatgpt.com/');
  stage = 'download';
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải file .txt' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('FPT-kiem-chung.txt');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toBe(text);
  await page.getByRole('button', { name: 'Đóng bản xuất' }).click();
  stage = 'Claude / clipboard fallback';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', { name: 'Kiểm chứng bằng Claude ↗', exact: true })
    .click();
  await expect(output).toBeVisible({ timeout: 45000 });
  await page
    .getByRole('button', { name: 'Sao chép & mở Claude ↗', exact: true })
    .click();
  expect(
    await page.evaluate(() => document.documentElement.dataset.auditTarget),
  ).toBe('https://claude.ai/new');
  await expect(
    page.getByRole('link', { name: 'Mở Claude ↗', exact: true }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw Error('blocked'); }
  }})`);
  await page.getByRole('button', { name: 'Sao chép', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'không cho sao chép tự động' }),
  ).toBeVisible();
  expect(
    await output.evaluate((el) => (el as HTMLTextAreaElement).selectionEnd),
  ).toBe((await output.inputValue()).length);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    'STOCK EXPORT BROWSER PASS: real Auth and public FPT APIs; no eager history; full financial/history/MA payload; actual displayed score/conclusion, every criterion explanation and risk exported; exact clipboard and downloaded file; fixed ChatGPT/Claude URLs without data; clipboard-denied fallback; 390/1440px; no JS errors. External AI input/inference not automated.',
  );
  await context.close();
} catch (error) {
  console.error(
    'STOCK EXPORT BROWSER FAIL at',
    stage,
    '(credentials and page content omitted)',
    error instanceof Error
      ? error.message.split('\n')[0]?.slice(0, 160)
      : 'unknown',
  );
  process.exitCode = 1;
} finally {
  try {
    await browser.close();
  } finally {
    await cleanup?.();
  }
}
