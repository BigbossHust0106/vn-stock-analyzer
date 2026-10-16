import { chromium, expect, type Browser } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { managementClient } from './sync-rankings';
import type { PaperState } from '../web/lib/paper';
import type { PaperTrade } from '../modules/paper/accounting';
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
  token: string;
}[] = [];
let browser: Browser | undefined;
function assert(v: unknown, m: string): asserts v {
  if (!v) throw Error(m);
}
try {
  for (const label of ['a', 'b']) {
    const email = `codex-paper-${label}-${randomUUID()}@example.test`,
      password = randomBytes(32).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(!error && data.user, 'Create test user failed');
    const db = createClient(url, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    users.push({ id: data.user.id, email, password, db, token: '' });
    const signed = await db.auth.signInWithPassword({ email, password });
    assert(!signed.error && signed.data.session, 'Test login failed');
    users.at(-1)!.token = signed.data.session.access_token;
  }
  const a = users[0]!,
    b = users[1]!;
  const api = async (path: string, body?: unknown, user = a) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + user.token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    console.log(
      'PAPER API CHECK:',
      body ? 'POST' : 'GET',
      path.split('?')[0],
      response.status,
    );
    return response;
  };
  assert(
    (await fetch(base + '/v1/paper')).status === 401,
    'Anonymous wallet API accessible',
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/paper?symbol=FPT');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(
    page.getByRole('heading', { name: 'Phòng đầu tư thử', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByLabel('Tên ví thử', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page
    .getByLabel('Tên ví thử', { exact: true })
    .fill('Ví trải nghiệm 100 triệu');
  await page.getByLabel('Vốn ban đầu (VND)', { exact: true }).fill('100000000');
  await page
    .getByRole('button', { name: 'Tạo ví và cấp vốn ảo', exact: true })
    .click();
  await expect(page.getByTestId('paper-cash')).toContainText('100.000.000');
  await page.getByLabel('Cách lấy giá thử').selectOption('cached');
  await page
    .getByRole('button', { name: 'Lấy giá tham khảo', exact: true })
    .click();
  await expect(page.getByTestId('paper-preview')).toContainText('Giá đã lưu');
  await expect(
    page.getByRole('button', { name: 'Xác nhận mua thử', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'Tôi đồng ý luyện tập theo giá đã lưu, có thể đã cũ.',
    })
    .check();
  const responsePromise = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/v1/paper/orders' &&
      r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Xác nhận mua thử', exact: true })
    .click();
  const buyResponse = await responsePromise;
  assert(buyResponse.ok(), 'Buy failed');
  const receipt = ((await buyResponse.json()) as { data: PaperTrade }).data;
  const intent = buyResponse.request().postDataJSON() as Record<
    string,
    unknown
  >;
  const expectedCash =
    100000000 -
    receipt.price_vnd * 100 -
    Math.ceil((receipt.price_vnd * 100 * 15) / 10000);
  await expect(page.getByTestId('paper-cash')).toContainText(
    new Intl.NumberFormat('vi-VN').format(expectedCash),
  );
  assert(
    receipt.fee_vnd === Math.ceil((receipt.price_vnd * 100 * 15) / 10000) &&
      receipt.tax_vnd === 0,
    'Buy fee or VND units wrong',
  );
  const replay = await api('/v1/paper/orders', intent);
  assert(replay.ok, 'Idempotent replay failed');
  assert(
    ((await replay.json()) as { data: PaperTrade }).data.id === receipt.id,
    'Replay duplicated trade',
  );
  let stateResponse = await api('/v1/paper');
  assert(
    stateResponse.headers.get('cache-control') === 'private, no-store',
    'Private API cached',
  );
  let state = (await stateResponse.json()) as PaperState;
  const wid = state.wallet!.id;
  assert(
    state.positions[0]?.quantity === 100 &&
      state.trades.length === 1 &&
      state.wallet!.cash_vnd === expectedCash,
    'Buy snapshot mismatch',
  );
  for (const table of [
    'paper_wallets',
    'paper_positions',
    'paper_quotes',
    'paper_trades',
  ]) {
    const other = await b.db.from(table).select('*');
    assert(!other.error && other.data.length === 0, 'B can read A ' + table);
  }
  assert(
    (await api('/v1/paper?wallet=' + wid, undefined, b)).status === 404,
    'B can load A wallet API',
  );
  assert(
    !!(
      await a.db.from('paper_wallets').update({ cash_vnd: 1e12 }).eq('id', wid)
    ).error,
    'Client can mint cash',
  );
  assert(
    (await api('/v1/paper/orders', { ...intent, owner_id: b.id, price_vnd: 1 }))
      .status === 400,
    'Client can supply price or owner',
  );
  assert(
    (
      await api(
        '/v1/paper/orders',
        { ...intent, requestId: randomUUID(), quoteId: receipt.quote_id },
        b,
      )
    ).status === 404,
    'B can execute against A wallet',
  );
  await page.reload();
  await expect(page.getByTestId('paper-cash')).toContainText(
    new Intl.NumberFormat('vi-VN').format(expectedCash),
  );
  await page.getByLabel('Thao tác thử').selectOption('sell');
  await page.getByLabel('Cách lấy giá thử').selectOption('cached');
  await page
    .getByRole('button', { name: 'Lấy giá tham khảo', exact: true })
    .click();
  await page
    .getByRole('checkbox', {
      name: 'Tôi đồng ý luyện tập theo giá đã lưu, có thể đã cũ.',
    })
    .check();
  const sellPromise = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/v1/paper/orders' &&
      r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Xác nhận bán thử', exact: true })
    .click();
  const sold = await sellPromise;
  assert(sold.ok(), 'Sell failed');
  const sell = ((await sold.json()) as { data: PaperTrade }).data;
  stateResponse = await api('/v1/paper');
  state = (await stateResponse.json()) as PaperState;
  const finalCash =
    expectedCash +
    sell.price_vnd * 100 -
    Math.ceil((sell.price_vnd * 100 * 15) / 10000) -
    Math.ceil((sell.price_vnd * 100 * 10) / 10000);
  assert(
    state.positions.length === 0 &&
      state.trades.length === 2 &&
      state.wallet!.cash_vnd === finalCash &&
      state.valuation?.nav_vnd === finalCash &&
      state.wallet!.realized_vnd === finalCash - 100000000,
    'Sale accounting mismatch',
  );
  await expect(page.getByTestId('paper-cash')).toContainText(
    new Intl.NumberFormat('vi-VN').format(finalCash),
  );
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({
    path: '.cache/screenshots/paper-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page
      .getByRole('navigation', { name: 'Điều hướng điện thoại' })
      .getByRole('link', { name: 'Đầu tư thử' }),
  ).toBeVisible();
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    'Mobile horizontal overflow',
  );
  await page.screenshot({
    path: '.cache/screenshots/paper-mobile.png',
    fullPage: true,
  });
  await page.evaluate(() =>
    document.documentElement.setAttribute('data-theme', 'dark'),
  );
  await page.screenshot({
    path: '.cache/screenshots/paper-mobile-dark.png',
    fullPage: true,
  });
  const second = await api('/v1/paper/wallets', {
    name: 'Vốn tùy chọn',
    capital: 123456789,
    feeBps: 0,
    taxBps: 0,
    requestId: randomUUID(),
  });
  assert(second.ok, 'Second wallet creation failed');
  const secondWallet = (
    (await second.json()) as { data: { id: string; cash_vnd: number } }
  ).data;
  assert(
    secondWallet.cash_vnd === 123456789,
    'Custom capital rounded or ignored',
  );
  const original = (await (
    await api('/v1/paper?wallet=' + wid)
  ).json()) as PaperState;
  const separate = (await (
    await api('/v1/paper?wallet=' + secondWallet.id)
  ).json()) as PaperState;
  assert(
    original.wallets.length === 2 &&
      original.trades.length === 2 &&
      original.wallet!.cash_vnd === finalCash &&
      separate.trades.length === 0 &&
      separate.wallet!.cash_vnd === 123456789,
    'Wallet histories or balances mixed',
  );
  const sourceQuote = await api('/v1/paper/quote', {
    symbol: 'FPT',
    mode: 'source',
  });
  assert(
    [200, 409, 503].includes(sourceQuote.status),
    'Unexpected live source status',
  );
  if (sourceQuote.ok) {
    const q = (
      (await sourceQuote.json()) as {
        data: { price_vnd: number; mode: string; observed_at: string };
      }
    ).data;
    assert(
      Number.isSafeInteger(q.price_vnd) &&
        q.price_vnd > 0 &&
        q.mode === 'source' &&
        Date.now() - Date.parse(q.observed_at) < 120000,
      'Live quote invalid',
    );
  }
  console.log(
    'PAPER VPS QUOTE HTTP:',
    sourceQuote.status,
    '(source availability observed, no silent fallback)',
  );
  assert(errors.length === 0, 'Browser runtime errors');
  await context.close();
  console.log(
    'PAPER BROWSER PASS: login gate; custom capital; cached-price consent; buy/sell fees and cash; idempotency; reload persistence; A/B RLS and forged price rejection; desktop/mobile; no runtime errors',
  );
  console.log(
    'PAPER MARKET EVIDENCE: real stored FPT price, explicitly acknowledged; no synthetic market rows; source freshness not assumed',
  );
} finally {
  await browser?.close();
  const cleanup = await Promise.allSettled(
    users.map(async (u) => {
      await u.db.auth.signOut();
      const r = await admin.auth.admin.deleteUser(u.id);
      assert(!r.error, 'Test user cleanup failed');
      const rows = await admin
        .from('paper_wallets')
        .select('id')
        .eq('owner_id', u.id);
      assert(!rows.error && rows.data.length === 0, 'Wallet cleanup failed');
    }),
  );
  if (cleanup.some((r) => r.status === 'rejected')) {
    console.error('PAPER CLEANUP FAIL: inspect temporary test accounts');
    process.exitCode = 1;
  } else
    console.log(
      'PAPER CLEANUP PASS: both temporary accounts and their virtual wallets removed',
    );
}
