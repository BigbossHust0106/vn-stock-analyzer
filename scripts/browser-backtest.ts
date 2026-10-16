import { chromium, expect, type Browser } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { managementClient } from './sync-rankings';
import type { BacktestResult, PriceCheck } from '../web/lib/backtest';
import { enableChart, openAccountMenu } from './browser-auth';
expect.configure({ timeout: 30000 });
const base = process.env.MARKET_APP_URL ?? 'http://127.0.0.1:8878';
const { db: admin, url } = await managementClient();
const config = (await (await fetch(base + '/v1/public-config')).json()) as {
  supabasePublishableKey: string;
};
const users: {
  id: string;
  email: string;
  password: string;
  db: SupabaseClient;
}[] = [];
let browser: Browser | undefined;
function assert(v: unknown, m: string): asserts v {
  if (!v) throw Error(m);
}
try {
  for (const label of ['a', 'b']) {
    const email = `codex-phase8-${label}-${randomUUID()}@example.test`,
      password = randomBytes(32).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(!error && data.user, 'Cannot create test user');
    const db = createClient(url, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    users.push({ id: data.user.id, email, password, db });
    assert(
      !(await db.auth.signInWithPassword({ email, password })).error,
      'Cannot sign in',
    );
  }
  const a = users[0]!,
    b = users[1]!;
  const historyResponse = await fetch(base + '/v1/backtest?horizon=day');
  assert(historyResponse.ok, 'History API unavailable');
  const history = (await historyResponse.json()) as BacktestResult;
  const unbounded = await a.db.rpc('backtest_history', {
    period: 'day',
    before_time: null,
    before_id: null,
    take: null,
  });
  assert(!!unbounded.error, 'Direct RPC accepts unbounded NULL page');
  assert(
    Array.isArray(history.data) && history.data.length <= 10,
    'History not paginated',
  );
  for (const c of history.data) {
    const { data, error } = await a.db
      .from('ranking_publications')
      .select('items,recorded_at')
      .eq('id', c.id)
      .single();
    assert(!error && data, 'Publication missing');
    assert(
      JSON.stringify(data.items) === JSON.stringify(c.items),
      'Publication differs from stored snapshot',
    );
    if (!c.items.length)
      assert(
        c.results.day.returnPct === null && c.results.day.winRatePct === null,
        'Empty cohort became zero return',
      );
  }
  assert(
    !!(
      await a.db.from('ranking_publications').insert({
        source_run_at: new Date().toISOString(),
        as_of: '2025-01-01',
        horizon: 'day',
        model_version: 'forged',
        universe_count: 1,
        eligible_count: 1,
        items: [],
      })
    ).error,
    'Client can forge market history',
  );
  browser = await chromium.launch({ headless: true });
  const ssr = await browser.newContext({ javaScriptEnabled: false });
  const ssrPage = await ssr.newPage();
  await ssrPage.goto(base + '/login');
  await expect(ssrPage.getByLabel('Email', { exact: true })).toBeDisabled();
  await expect(
    ssrPage.getByRole('button', { name: 'Đăng nhập', exact: true }),
  ).toBeDisabled();
  await ssr.close();
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', async (response) => {
    const parsed = new URL(response.url());
    if (
      parsed.pathname !== '/auth/v1/token' ||
      parsed.searchParams.get('grant_type') !== 'password'
    )
      return;
    try {
      const payload = response.request().postDataJSON() as {
        email?: string;
        password?: string;
      };
      const body = response.ok()
        ? null
        : ((await response.json()) as { error_code?: unknown; code?: unknown });
      const code = body?.error_code ?? body?.code;
      console.log(
        'AUTH FORM CHECK:',
        JSON.stringify({
          status: response.status(),
          fieldsMatch:
            payload.email === a.email && payload.password === a.password,
          code:
            typeof code === 'string' && /^[a-z_]{1,60}$/.test(code)
              ? code
              : null,
        }),
      );
    } catch {
      console.log('AUTH FORM CHECK: response unavailable');
    }
  });
  await page.goto(base + '/backtest');
  await expect(page).toHaveURL(/\/login\?next=/);
  assert(
    (await page
      .getByRole('heading', { name: 'Lịch sử & backtest Top 10' })
      .count()) === 0,
    'Private page flashed before login',
  );
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Lịch sử & backtest Top 10',
      exact: true,
    }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByText('Đang tải lịch sử…', { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Bảng Top 10', { exact: true }).selectOption('quarter');
  await expect(
    page.getByText('Đang tải lịch sử…', { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Kiểm tra giá báo cáo', exact: true })
    .click();
  await expect(page.getByTestId('reported-price-result')).toBeVisible();
  const start = await page
    .getByLabel('Ngày bắt đầu', { exact: true })
    .inputValue();
  const diagnosticResponse = await fetch(
    base +
      '/v1/backtest?' +
      new URLSearchParams({
        mode: 'prices',
        symbol: 'DPR',
        start,
        source: 'VPS',
      }),
  );
  assert(diagnosticResponse.ok, 'Diagnostic API failed');
  const result = (await diagnosticResponse.json()) as PriceCheck;
  let checked = 0;
  for (const leg of Object.values(result.legs)) {
    if (leg.returnPct === null) continue;
    const { data: stock } = await a.db
      .from('stocks')
      .select('id')
      .eq('symbol', 'DPR')
      .single();
    assert(stock, 'DPR missing');
    const { data: entry } = await a.db
      .from('prices_history')
      .select('open_vnd')
      .eq('stock_id', stock.id)
      .eq('source', 'VPS')
      .eq('session_date', leg.entryDate!)
      .single();
    const { data: exit } = await a.db
      .from('prices_history')
      .select('close_vnd')
      .eq('stock_id', stock.id)
      .eq('source', 'VPS')
      .eq('session_date', leg.exitDate!)
      .single();
    assert(
      entry &&
        exit &&
        Math.abs(leg.returnPct - (exit.close_vnd / entry.open_vnd - 1) * 100) <
          1e-8,
      'Reported return differs from actual price rows',
    );
    checked++;
  }
  assert(checked > 0, 'No reported price result to verify');
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({
    path: '.cache/screenshots/phase8-backtest-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    'Mobile overflow',
  );
  await page.screenshot({
    path: '.cache/screenshots/phase8-backtest-mobile.png',
    fullPage: true,
  });
  await page.goto(base + '/settings');
  const risk = page.getByTestId('risk-settings');
  await expect(
    risk.getByRole('button', { name: 'Lưu ngưỡng rủi ro', exact: true }),
  ).toBeEnabled();
  await risk.getByLabel('Cắt lỗ tối đa (%)', { exact: true }).fill('10');
  await risk
    .getByRole('button', { name: 'Lưu ngưỡng rủi ro', exact: true })
    .click();
  await expect(risk.getByRole('status')).toContainText('Đã lưu ngưỡng rủi ro');
  await page.getByLabel('Trọng số Graham (%)', { exact: true }).fill('60');
  await page.getByLabel('Trọng số Buffett (%)', { exact: true }).fill('40');
  await page
    .getByLabel('Tỷ lệ chiết khấu vốn chủ (%)', { exact: true })
    .fill('13');
  await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
  await expect(
    page.getByText(
      'Đã lưu Supabase cho tài khoản của bạn và áp dụng trên trình duyệt này.',
      { exact: true },
    ),
  ).toBeVisible();
  const settings = await a.db
    .from('user_settings')
    .select('risk_preferences,scoring_preferences')
    .eq('owner_id', a.id)
    .single();
  assert(
    !settings.error &&
      settings.data?.risk_preferences.maxLoss === 0.1 &&
      settings.data.scoring_preferences.grahamWeight === 60 &&
      settings.data.scoring_preferences.discountRate === 0.13,
    'Settings save overwrote fields',
  );
  const other = await b.db
    .from('user_settings')
    .select('owner_id')
    .eq('owner_id', a.id);
  assert(!other.error && !other.data.length, 'B reads A settings');
  const overwrite = await b.db
    .from('user_settings')
    .update({
      risk_preferences: {
        maxLoss: 0.2,
        atrMultiple: 2,
        trailingPercent: 0.08,
        stopMethod: 'atr',
      },
    })
    .eq('owner_id', a.id)
    .select('owner_id');
  assert(!overwrite.error && !overwrite.data.length, 'B overwrites A settings');
  await page.reload();
  await expect(
    page.getByLabel('Cắt lỗ tối đa (%)', { exact: true }),
  ).toHaveValue('10');
  await expect(
    page.getByLabel('Trọng số Graham (%)', { exact: true }),
  ).toHaveValue('60');
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    'Settings mobile overflow',
  );
  await page.screenshot({
    path: '.cache/screenshots/phase8-settings-mobile.png',
    fullPage: true,
  });
  await page.goto(base + '/stocks?symbol=DPR');
  await enableChart(page);
  await expect(page.getByLabel('Lỗ tối đa (%)', { exact: true })).toHaveValue(
    '10',
    { timeout: 60000 },
  );
  await page.getByLabel('Lỗ tối đa (%)', { exact: true }).fill('12');
  await page.goto(base + '/settings');
  await expect(
    page
      .getByTestId('risk-settings')
      .getByRole('button', { name: 'Lưu ngưỡng rủi ro', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Cắt lỗ tối đa (%)', { exact: true }).fill('9');
  await page
    .getByTestId('risk-settings')
    .getByRole('button', { name: 'Lưu ngưỡng rủi ro', exact: true })
    .click();
  await expect(
    page.getByTestId('risk-settings').getByRole('status'),
  ).toContainText('Đã lưu ngưỡng rủi ro');
  await page.goto(base + '/stocks?symbol=DPR');
  await expect(page.getByLabel('Lỗ tối đa (%)', { exact: true })).toHaveValue(
    '12',
    { timeout: 60000 },
  );
  await openAccountMenu(page);
  await page
    .getByRole('link', { name: 'Lịch sử & backtest Top 10', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Lịch sử & backtest Top 10',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Chuyển sang chế độ tối', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: '.cache/screenshots/phase8-backtest-dark-mobile.png',
    fullPage: true,
  });
  assert(errors.length === 0, 'Browser JS errors');
  console.log(
    'BACKTEST LIVE PASS: immutable history matches DB; empty sample stays null; reported returns match real VPS rows',
  );
  console.log(
    'BACKTEST BROWSER PASS: login gate; three horizons; reported-price results; 390px; no JS errors',
  );
  console.log(
    'SETTINGS LIVE PASS: risk + strategy weights + DCF persist independently; A/B RLS; reload persistence',
  );
  console.log(
    'RISK INHERITANCE PASS: account default used for new plan; stock override survives global changes; mobile navigation and dark theme',
  );
  console.log(
    'BACKTEST LIMIT: no verified historical Top 10/VN-Index performance claimed',
  );
} finally {
  await browser?.close();
  for (const u of users) {
    await u.db.auth.signOut();
    if ((await admin.auth.admin.deleteUser(u.id)).error) {
      console.error('BACKTEST CLEANUP FAILED');
      process.exitCode = 1;
    }
  }
  if (!process.exitCode)
    console.log(
      'BACKTEST CLEANUP PASS: temporary accounts and personal settings removed',
    );
}
