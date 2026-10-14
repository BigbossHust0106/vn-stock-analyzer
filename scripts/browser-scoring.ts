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
  // A stock detail may await three providers, each with bounded retries.
  // Financials are requested only after that response, not on initial navigation.
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(e.message));
  for (const symbol of ['VNM', 'FPT', 'HPG']) {
    const financialResponse = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/v1/financials/' + symbol &&
        r.status() === 200,
      { timeout: 300000 },
    );
    const marketResponse = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/v1/stocks/' + symbol &&
        r.status() === 200,
      { timeout: 300000 },
    );
    await page.goto(base + '/stocks?symbol=' + symbol);
    const financial = (await (await financialResponse).json()) as {
      financials: import('../modules/providers/financial-types').FinancialData;
    };
    const market = (await (await marketResponse).json()) as {
      quote: { lastPriceVnd: number | null };
    };
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
    const last = financial.financials.annual.at(-1)!;
    const eps2025: Record<string, number> = { VNM: 4028, FPT: 5216, HPG: 1973 };
    if (last.year === 2025 && last.epsAnnualVnd !== eps2025[symbol])
      throw new Error(
        'Annual EPS differs from recorded independent fixture evidence',
      );
    const epsLabel =
      last.epsAnnualVnd === null
        ? '—'
        : last.epsAnnualVnd.toLocaleString('vi-VN', {
            maximumFractionDigits: 2,
          });
    if (
      (await page
        .getByTestId('financial-epsAnnualVnd')
        .locator('td')
        .last()
        .innerText()) !== epsLabel
    )
      throw new Error('Rendered EPS unit/value mismatch');
    const proxy =
      last.operatingCashFlowVnd !== null && last.capexVnd !== null
        ? last.operatingCashFlowVnd - last.capexVnd
        : null;
    if (proxy !== null && proxy > 0 && financial.financials.currentShares) {
      // Independent DCF: default g5%, equity rate12%, terminal2%, five years; no engine imports.
      let pv = 0;
      for (let t = 1; t <= 5; t++) pv += (proxy * 1.05 ** t) / 1.12 ** t;
      pv += (proxy * 1.05 ** 5 * 1.02) / (0.12 - 0.02) / 1.12 ** 5;
      const value = pv / financial.financials.currentShares;
      const expected =
        value.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' VND';
      if (
        (await page.getByTestId('dcf-scenario-value').innerText()) !== expected
      )
        throw new Error('DCF scenario arithmetic mismatch');
      if (market.quote?.lastPriceVnd) {
        const mos =
          (((value - market.quote.lastPriceVnd) / value) * 100).toFixed(1) +
          '%';
        if ((await page.getByTestId('dcf-scenario-mos').innerText()) !== mos)
          throw new Error('Scenario MOS mismatch');
      }
    } else if (
      (await page.getByTestId('dcf-scenario-value').innerText()) !==
      'Không đủ dữ liệu'
    )
      throw new Error('Invalid/non-positive CFO scenario unexpectedly valued');
    if (
      (await page
        .getByTestId('criterion-buffett-dcf')
        .getAttribute('data-status')) !== 'unknown' ||
      (await page.getByTestId('intrinsic-buffett').innerText()) !==
        'Không đủ dữ liệu'
    )
      throw new Error(
        'Unverified consolidated cashflow used as parent valuation',
      );
    const comparable =
      last.sharesOutstanding !== null &&
      last.sharesOutstanding === financial.financials.currentShares;
    if (
      comparable &&
      last.epsAnnualVnd !== null &&
      last.epsAnnualVnd > 0 &&
      last.bvpsVnd !== null &&
      last.bvpsVnd > 0
    ) {
      const value = Math.sqrt(22.5 * last.epsAnnualVnd * last.bvpsVnd);
      if (
        (await page.getByTestId('intrinsic-graham').innerText()) !==
        value.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' VND'
      )
        throw new Error('Graham Number arithmetic mismatch');
      if (market.quote?.lastPriceVnd) {
        const mos =
          (((value - market.quote.lastPriceVnd) / value) * 100).toFixed(1) +
          '%';
        if ((await page.getByTestId('mos-graham').innerText()) !== mos)
          throw new Error('Graham MOS mismatch');
      }
    } else if (
      (await page.getByTestId('intrinsic-graham').innerText()) !==
      'Không đủ dữ liệu'
    )
      throw new Error('Graham missing-share guard not rendered');
    await page.screenshot({
      path: `.cache/screenshots/${symbol}-scoring.png`,
      fullPage: true,
    });
    console.log(
      `SCORING BROWSER PASS: ${symbol}, score ${score.replace(/\s+/g, ' ')}, ${decision}, annual EPS numeric/unit; Graham and scenarioDCF/MOS arithmetic or missing-data guard; parent DCF unknown`,
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
  await page.getByTestId('scoring-panel').waitFor({ timeout: 300000 });
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
