import type { RankingRow } from '../web/lib/rankings';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import deployment from '../config/public-deployment.json';
import { managementClient } from './sync-rankings';
import { authenticateBrowser } from './browser-auth';
import { graham } from '../modules/strategies/graham';
import { isFinancialData } from '../modules/providers/financial-types';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const { db: admin } = await managementClient();
const configResponse = await fetch(deployment.workerUrl + '/v1/public-config');
assert(configResponse.ok, 'Public configuration unavailable');
const config = (await configResponse.json()) as {
  supabaseUrl: string;
  supabasePublishableKey: string;
};
const anon = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: { persistSession: false },
});
const { data: stock, error: stockError } = await admin
  .from('stocks')
  .select('id')
  .eq('symbol', 'DPR')
  .single();
assert(stock && !stockError, 'DPR missing');
const { data: snapshot, error } = await admin
  .from('financial_snapshots')
  .select('payload')
  .eq('stock_id', stock.id)
  .single();
assert(
  !error && isFinancialData(snapshot?.payload),
  'DPR financial snapshot invalid',
);
const f = snapshot.payload;
assert(
  f.documentEvidence?.length === 3 &&
    f.documentEvidence.at(-1)!.dividendsPaidVnd === 173304337550,
  'Parent cash evidence missing or confused with group amount',
);
assert(
  graham(f, 37400, new Date().toISOString()).criteria.find(
    (c) => c.id === 'dividends',
  )?.status === 'pass',
  'Parent dividends still unknown',
);
console.log(
  'DPR EVIDENCE PASS: 3 fiscal years from primary PDF; parent dividends separate from consolidated; unknown dividend criterion resolved',
);
for (const horizon of ['day', 'month', 'quarter']) {
  const ranked = await anon.rpc('top_rankings', { period: horizon });
  assert(
    !ranked.error && Array.isArray(ranked.data),
    'Cannot read strict rankings',
  );
  assert(
    ranked.data.every(
      (row: RankingRow) =>
        row.explanation.rankingEligibility?.eligible === true &&
        row.explanation.coverage === 1,
    ),
    'Partial input leaked into ranking',
  );
  assert(
    ranked.data.every((row: RankingRow) => row.symbol !== 'DPR'),
    'DPR incorrectly ranked with missing critical input',
  );
  const excluded = await anon.rpc('ranking_candidates', { period: horizon });
  assert(
    !excluded.error &&
      excluded.data?.some(
        (row: RankingRow) =>
          row.symbol === 'DPR' &&
          row.position === null &&
          (row.explanation.rankingEligibility?.blockers.length ?? 0) > 0,
      ),
    'DPR missing from evidence queue',
  );
  console.log(
    `RANKING QUALITY PASS: ${horizon}, ${ranked.data.length} qualified, ${excluded.data.length} unranked with blockers; public RLS read`,
  );
}
if (process.argv.includes('--browser')) {
  const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
  const browser = await chromium.launch({ headless: true });
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(60000);
    cleanup = await authenticateBrowser(page, base, '/top10');
    await page
      .getByLabel('Kỳ xếp hạng', { exact: true })
      .selectOption('quarter');
    // Audit candidates are no longer rendered beneath Top10, even when no row qualifies.
    await expect(page.getByTestId('ranking-quarter')).toContainText('Top 10');
    await expect(page.locator('[data-testid^="unranked-"]')).toHaveCount(0);
    assert(
      (await page.locator('[data-testid="top10-table"] tbody tr').count()) <=
        10,
      'Top10 overflow',
    );
    await mkdir('.cache/screenshots', { recursive: true });
    await page.screenshot({
      path: '.cache/screenshots/ranking-quality-desktop.png',
      fullPage: true,
    });
    await page.goto(base + '/stocks?symbol=DPR');
    await expect(page.getByTestId('comparison-status')).toBeVisible({
      timeout: 300000,
    });
    await expect(
      page.getByTestId('criterion-graham-dividends'),
    ).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('criterion-buffett-dcf')).toHaveAttribute(
      'data-status',
      'unknown',
    );
    await expect(page.getByTestId('criterion-buffett-roe')).toContainText(
      '11,41%',
    );
    await expect(page.getByTestId('document-sources')).toContainText(
      '173.304.337.550',
    );
    await expect(
      page.getByTestId('financial-parent-dividendsPaidVnd'),
    ).toContainText('173,304');
    await page.screenshot({
      path: '.cache/screenshots/DPR-quality-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      'DPR mobile overflow',
    );
    await page.screenshot({
      path: '.cache/screenshots/DPR-quality-mobile.png',
      fullPage: true,
    });
    assert(
      errors.length === 0,
      'Browser JavaScript error count: ' + errors.length,
    );
    console.log(
      'QUALITY BROWSER PASS: DPR actual values and PDF links; temporary score warning; unknown DCF not fabricated; audit candidates excluded from Top10; 390px; no JS errors',
    );
  } finally {
    try {
      await browser.close();
    } finally {
      await cleanup?.();
    }
    console.log(
      'QUALITY CLEANUP PASS: temporary auth user and private data removed',
    );
  }
}
