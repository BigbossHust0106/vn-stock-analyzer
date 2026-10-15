import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { managementClient } from './sync-rankings';
expect.configure({ timeout: 30000 });
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const { db: admin, key, url } = await managementClient();
const config = (await (await fetch(base + '/v1/public-config')).json()) as {
  supabasePublishableKey: string;
};
const users: {
  id: string;
  email: string;
  password: string;
  db: SupabaseClient;
  token: string;
}[] = [];
let browser: Browser | undefined;
try {
  for (const label of ['a', 'b']) {
    const email = `codex-phase7-${label}-${randomUUID()}@example.test`,
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
    users.push({ id: data.user.id, email, password, db, token: '' });
    const login = await db.auth.signInWithPassword({ email, password });
    assert(!login.error && login.data.session, 'Cannot sign in');
    users.at(-1)!.token = login.data.session.access_token;
  }
  const a = users[0]!,
    b = users[1]!;
  const { data: stock, error: se } = await a.db
    .from('stocks')
    .select('id')
    .eq('symbol', 'DPR')
    .single();
  assert(!se && stock, 'Real DPR missing');
  const { data: list, error: le } = await a.db
    .from('watchlists')
    .insert({ name: 'Phase7 verification' })
    .select('id')
    .single();
  assert(!le && list, 'Cannot create own watchlist');
  assert(
    !(
      await a.db
        .from('watchlist_items')
        .insert({ watchlist_id: list.id, stock_id: stock.id })
    ).error,
    'Cannot add own symbol',
  );
  const rule = await a.db
    .from('watchlist_alert_rules')
    .insert({
      watchlist_id: list.id,
      stock_id: stock.id,
      kind: 'buy_zone',
      lower_vnd: 1,
      upper_vnd: 2,
    })
    .select('id')
    .single();
  assert(!rule.error && rule.data, 'Cannot create alert rule');
  assert(
    (await b.db.from('watchlist_alert_rules').select('id')).data?.length === 0,
    'B reads A rule',
  );
  assert(
    !!(
      await b.db.from('watchlist_alert_rules').insert({
        watchlist_id: list.id,
        stock_id: stock.id,
        kind: 'stop_loss',
        lower_vnd: 1,
      })
    ).error,
    'B attaches rule to A item',
  );
  const denial = await fetch(base + '/v1/notifications/test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + b.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ watchlistId: list.id, stockId: stock.id }),
  });
  assert(denial.status === 400, 'B can create A notification');
  assert(
    (await fetch(base + '/v1/notifications')).status === 401,
    'Anonymous sees notifications',
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const jsErrors: string[] = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  await page.goto(base + '/login?next=%2Falerts');
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cảnh báo & thông báo', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByLabel('Mã cảnh báo')).toContainText('DPR');
  await page
    .getByRole('button', { name: 'Gửi cảnh báo thử', exact: true })
    .click();
  await expect(
    page.getByTestId('notification-card').filter({ hasText: 'Cảnh báo thử' }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('notification-count')).toHaveText('1');
  const receipts = await a.db
    .from('notifications')
    .select('id,kind')
    .eq('kind', 'test');
  assert(
    !receipts.error && receipts.data.length === 1,
    'Own test notification not persisted',
  );
  const bRead = await b.db
    .from('notifications')
    .select('id')
    .eq('id', receipts.data[0]!.id);
  assert(!bRead.error && bRead.data.length === 0, 'B reads A notification');
  const bWrite = await b.db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', receipts.data[0]!.id)
    .select('id');
  assert(!bWrite.error && bWrite.data.length === 0, 'B marks A notification');
  assert(
    !!(
      await a.db
        .from('notifications')
        .update({ body: 'forged' })
        .eq('id', receipts.data[0]!.id)
    ).error,
    'A can forge server message',
  );
  await page
    .getByRole('button', { name: 'Đánh dấu đã đọc', exact: true })
    .click();
  await expect(page.getByTestId('notification-count')).toHaveText('0');
  await page
    .getByLabel('Loại cảnh báo', { exact: true })
    .selectOption('important_news');
  await page.getByRole('button', { name: 'Lưu quy tắc', exact: true }).click();
  await expect(
    page.getByText('Đã lưu. Kiểm tra cảnh báo mỗi 5 phút;', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Bật Tin quan trọng DPR', exact: true })
    .uncheck();
  await expect
    .poll(
      async () =>
        (
          await a.db
            .from('watchlist_alert_rules')
            .select('enabled')
            .eq('kind', 'important_news')
            .single()
        ).data?.enabled,
    )
    .toBe(false);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({
    path: '.cache/screenshots/phase7-alerts-desktop.png',
    fullPage: true,
  });
  await mobile(page, '.cache/screenshots/phase7-alerts-mobile.png');
  const stamp = String(Date.now()),
    signature = createHmac('sha256', key)
      .update(stamp + ':POST:/v1/internal/system-sync')
      .digest('hex');
  const sync = await fetch(base + '/v1/internal/system-sync', {
    method: 'POST',
    headers: { 'X-Job-Timestamp': stamp, 'X-Job-Signature': signature },
    signal: AbortSignal.timeout(180000),
  });
  assert(sync.ok, 'Maintenance HTTP ' + sync.status);
  const status = await fetch(base + '/v1/system-status');
  assert(status.ok, 'Status HTTP');
  const state = (await status.json()) as {
    freshness: Record<string, string | null>;
    jobs: { job: string; state: string }[];
    health: { provider: string; state: string; checked_at: string }[];
  };
  const [{ data: price }, { data: scores }, { data: news }] = await Promise.all(
    [
      admin
        .from('prices_current')
        .select('fetched_at')
        .order('fetched_at', { ascending: false })
        .limit(1),
      admin
        .from('scores')
        .select('computed_at')
        .order('computed_at', { ascending: false })
        .limit(1),
      admin
        .from('news_feed_articles')
        .select('fetched_at')
        .order('fetched_at', { ascending: false })
        .limit(1),
    ],
  );
  for (const [key, expected] of [
    ['prices', price?.[0]?.fetched_at],
    ['scores', scores?.[0]?.computed_at],
    ['news', news?.[0]?.fetched_at],
  ] as const) {
    assert(
      expected &&
        state.freshness[key] &&
        Date.parse(expected) === Date.parse(state.freshness[key]!),
      'Freshness mismatches actual table: ' + key,
    );
  }
  assert(
    state.jobs.some((j) => j.job === 'alerts' && j.state === 'ok'),
    'No successful alert job logged',
  );
  assert(
    state.health.some((h) => h.provider === 'VPS'),
    'No VPS probe recorded',
  );
  await page.goto(base + '/status');
  await expect(page.getByTestId('status-prices')).toContainText('Giá VPS');
  await expect(page.getByTestId('vps-health')).toBeVisible();
  await page.screenshot({
    path: '.cache/screenshots/phase7-status-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: '.cache/screenshots/phase7-status-desktop.png',
    fullPage: true,
  });
  assert(jsErrors.length === 0, 'Browser JS errors');
  console.log(
    'ALERTS LIVE PASS: real Supabase A/B isolation; watchlist ownership; server message immutable; anonymous denied',
  );
  console.log(
    'ALERTS BROWSER PASS: create test alert, receive in app, unread 1→0, rule creation/toggle persisted, 390px, no JS errors',
  );
  console.log(
    'STATUS LIVE PASS: price/score/news timestamps match actual tables; maintenance logged; VPS probe recorded',
  );
  console.log(
    'EMAIL LIVE NOT VERIFIED: no Resend key/verified sender supplied; provider tests use fixtures only',
  );
} finally {
  await browser?.close();
  for (const u of users) {
    await u.db.auth.signOut();
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) {
      console.error(
        'ALERTS CLEANUP FAILED: temporary user could not be removed',
      );
      process.exitCode = 1;
    }
  }
  if (!process.exitCode)
    console.log(
      'ALERTS CLEANUP PASS: temporary users, watchlists, rules and notifications removed',
    );
}
async function mobile(page: Page, path: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    'Mobile overflow',
  );
  await page.screenshot({ path, fullPage: true });
}
