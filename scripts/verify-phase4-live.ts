import { openAccountMenu } from './browser-auth';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { managementClient } from './sync-rankings';
import deployment from '../config/public-deployment.json';
import worker from '../worker/src/index';
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { defaultSettings } from '../modules/settings/scoring-settings';
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function main() {
  const { db: admin, url } = await managementClient(),
    created: string[] = [],
    users: {
      email: string;
      password: string;
      db: SupabaseClient;
      id: string;
    }[] = [];
  let browser: Browser | undefined;
  let debugPage: Page | undefined,
    browserFailed = true;
  const configResponse = await fetch(
    deployment.workerUrl + '/v1/public-config',
    { signal: AbortSignal.timeout(15000) },
  );
  assert(configResponse.ok, 'Không tải được public config');
  const config = (await configResponse.json()) as {
    supabasePublishableKey: string;
    supabaseUrl: string;
  };
  assert(
    config.supabaseUrl === url &&
      /^sb_publishable_/.test(config.supabasePublishableKey),
    'Sai project/public key',
  );
  try {
    for (const label of ['a', 'b']) {
      const email = `codex-phase4-${label}-${randomUUID()}@example.test`,
        password = randomBytes(32).toString('base64url');
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      assert(!error && data.user, 'Không tạo được user tạm');
      created.push(data.user.id);
      const db = createClient(url, config.supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await db.auth.signInWithPassword({ email, password });
      assert(
        !login.error && login.data.user?.id === data.user.id,
        'Đăng nhập email/password thật thất bại',
      );
      users.push({ email, password, db, id: data.user.id });
    }
    console.log(
      'AUTH LIVE PASS: 2 user tạm đăng nhập email/password qua Supabase Auth, nhận JWT thật',
    );
    const a = users[0]!,
      b = users[1]!;
    const { data: stock, error: stockError } = await a.db
      .from('stocks')
      .select('id')
      .eq('symbol', 'VNM')
      .single();
    assert(stock && !stockError, 'Không có VNM thật');
    const { data: list, error: listError } = await b.db
      .from('watchlists')
      .insert({ name: 'Temporary B' })
      .select('id')
      .single();
    assert(list && !listError, 'Không tạo được danh sách B');
    const inserted = await b.db.from('watchlist_items').insert({
      watchlist_id: list.id,
      stock_id: stock.id,
      notes: 'B note',
      target_price_vnd: 50000,
    });
    assert(!inserted.error, 'Không thêm item B');
    const snapshot = await b.db.rpc('watchlist_snapshot', {
      list_id: list.id,
      period: 'quarter',
    });
    assert(
      !snapshot.error && snapshot.data?.[0]?.notes === 'B note',
      'B không thấy snapshot của B',
    );
    assert(
      (await a.db.rpc('watchlist_snapshot', { list_id: list.id })).data
        ?.length === 0,
      'A thấy snapshot B',
    );
    const read = await a.db.from('watchlists').select('id').eq('id', list.id);
    assert(!read.error && read.data.length === 0, 'A đọc được danh sách B');
    const update = await a.db
      .from('watchlist_items')
      .update({ notes: 'forged', target_price_vnd: 1 })
      .eq('watchlist_id', list.id)
      .select('stock_id');
    assert(!update.error && update.data.length === 0, 'A sửa được note/giá B');
    const remove = await a.db
      .from('watchlists')
      .delete()
      .eq('id', list.id)
      .select('id');
    assert(!remove.error && remove.data.length === 0, 'A xóa được B');
    const forged = await a.db
      .from('watchlists')
      .insert({ owner_id: b.id, name: 'Forged' });
    assert(!!forged.error, 'A giả owner B');
    const parent = await a.db
      .from('watchlist_items')
      .insert({ watchlist_id: list.id, stock_id: stock.id });
    assert(!!parent.error, 'A gắn mã vào danh sách B');
    const own = await b.db
      .from('watchlist_items')
      .update({ notes: 'B updated', target_price_vnd: 49000 })
      .eq('watchlist_id', list.id)
      .select('notes,target_price_vnd');
    assert(
      !own.error && own.data?.[0]?.target_price_vnd === 49000,
      'B không cập nhật được dữ liệu của B',
    );
    const anon = createClient(url, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assert(
      (await anon.from('watchlists').select('id')).error,
      'Anon đọc watchlists',
    );
    assert(
      (await anon.rpc('watchlist_snapshot', { list_id: list.id })).error,
      'Anon gọi private RPC',
    );
    console.log(
      'RLS HOSTED PASS: JWT A/B isolation; own notes/target CRUD; forged owner/parent and anon denied',
    );
    const userSession = await a.db.auth.getSession();
    const token = userSession.data.session!.access_token;
    const response = await worker.fetch(
      new Request('https://app.test/v1/watchlists', {
        headers: { Authorization: 'Bearer ' + token },
      }),
      {
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: config.supabasePublishableKey,
      },
    );
    assert(response.status === 200, 'Worker từ chối JWT thật');
    assert(
      (
        await worker.fetch(new Request('https://app.test/v1/watchlists'), {
          SUPABASE_URL: url,
          SUPABASE_PUBLISHABLE_KEY: config.supabasePublishableKey,
        })
      ).status === 401,
      'Worker cho anonymous truy cập',
    );
    for (const horizon of ['day', 'month', 'quarter']) {
      const { data, error } = await anon.rpc('top_rankings', {
        period: horizon,
      });
      assert(
        !error && data?.length === 10,
        'Chưa đủ 10 cổ phiếu thật: ' + horizon,
      );
      assert(
        data.every(
          (row: { score: number; symbol: string }) =>
            Number.isFinite(row.score) && /^[A-Z0-9]{3,12}$/.test(row.symbol),
        ),
        'Score/mã không hợp lệ',
      );
      assert(
        data.every(
          (row: {
            explanation: { rankingEligibility?: { eligible?: boolean } };
          }) => row.explanation.rankingEligibility?.eligible === true,
        ),
        'Top10 chứa mã chưa đủ bằng chứng',
      );
      console.log(
        `TOP10 HOSTED PASS: ${horizon}, ${data.length} rows từ rankings/scores thật`,
      );
    }
    if (!process.argv.includes('--browser')) return;
    const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      }),
      page = await context.newPage(),
      errors: string[] = [];
    debugPage = page;
    page.on('pageerror', (e) => errors.push(e.message));
    const providerResponse = await fetch(url + '/auth/v1/settings', {
      headers: { apikey: config.supabasePublishableKey },
      signal: AbortSignal.timeout(10000),
    });
    const providerSettings = (await providerResponse.json()) as {
      external?: { google?: boolean };
    };
    if (providerSettings.external?.google === false) {
      await page.goto(base + '/login');
      await page
        .getByRole('button', { name: 'Tiếp tục với Google', exact: true })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Google tạm chưa khả dụng' })
        .waitFor({ timeout: 30000 });
      assert(
        new URL(page.url()).pathname === '/login',
        'Google chưa bật nhưng redirect tới trang lỗi',
      );
    }
    await page.goto(base + '/watchlists');
    await page.waitForURL('**/login?next=%2Fwatchlists', { timeout: 30000 });
    await page.getByLabel('Email', { exact: true }).fill(a.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(a.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL('**/watchlists', { timeout: 30000 });
    await page
      .getByLabel('Tên danh sách mới', { exact: true })
      .fill('Temporary A');
    await page
      .getByRole('button', { name: 'Tạo danh sách', exact: true })
      .click();
    await page.getByLabel('Danh sách của bạn', { exact: true }).waitFor();
    await page.getByLabel('Mã chứng khoán', { exact: true }).fill('VNM');
    await page.getByRole('button', { name: 'Thêm mã', exact: true }).click();
    await page.getByTestId('watch-VNM').waitFor({ timeout: 30000 });
    await page
      .getByLabel('Ghi chú VNM', { exact: true })
      .fill('Saved in browser');
    await page
      .getByLabel('Giá mua mục tiêu VNM (đồng)', { exact: true })
      .fill('48000');
    await page.getByRole('button', { name: 'Lưu VNM', exact: true }).click();
    await page
      .getByTestId('watch-VNM')
      .getByRole('status')
      .filter({ hasText: 'Đã lưu.' })
      .waitFor();
    await page.reload();
    await page.getByTestId('watch-VNM').waitFor({ timeout: 30000 });
    assert(
      (await page.getByLabel('Ghi chú VNM', { exact: true }).inputValue()) ===
        'Saved in browser',
      'Note không lưu sau reload',
    );
    assert(
      (await page
        .getByLabel('Giá mua mục tiêu VNM (đồng)', { exact: true })
        .inputValue()) === '48000',
      'Target không lưu sau reload',
    );
    await page
      .getByLabel('Tên danh sách mới', { exact: true })
      .fill('Second A');
    await page
      .getByRole('button', { name: 'Tạo danh sách', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('select')[0]?.selectedOptions[0]
          ?.textContent === 'Second A',
    );
    await page
      .getByLabel('Danh sách của bạn', { exact: true })
      .selectOption({ label: 'Temporary A' });
    await page.getByTestId('watch-VNM').waitFor();
    await page.goto(base + '/top10');
    for (const horizon of ['day', 'month', 'quarter']) {
      await page
        .getByLabel('Kỳ xếp hạng', { exact: true })
        .selectOption(horizon);
      await page
        .getByTestId('ranking-' + horizon)
        .locator('tbody tr')
        .nth(9)
        .waitFor({ timeout: 30000 });
    }
    await page.getByLabel('Sàn', { exact: true }).selectOption('HNX');
    await page.waitForTimeout(500);
    await page.getByLabel('Sàn', { exact: true }).selectOption('');
    await page
      .getByTestId('ranking-quarter')
      .getByRole('button', { name: /Theo dõi/ })
      .first()
      .click();
    await page.getByRole('dialog').waitFor();
    await page
      .getByRole('dialog')
      .getByLabel('Danh sách', { exact: true })
      .selectOption({ label: 'Second A' });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Thêm vào danh sách', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('status')
      .filter({ hasText: 'Đã thêm' })
      .waitFor();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Đóng', exact: true })
      .click();
    await mkdir('.cache/screenshots', { recursive: true });
    await page.screenshot({
      path: '.cache/screenshots/phase4-top10.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page
      .getByLabel('Kỳ xếp hạng', { exact: true })
      .selectOption('quarter');
    await page
      .getByTestId('ranking-quarter')
      .locator('tbody tr')
      .nth(9)
      .waitFor({ timeout: 30000 });
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )),
      'Mobile top10 overflow',
    );
    await page.screenshot({
      path: '.cache/screenshots/phase4-mobile.png',
      fullPage: true,
    });
    await page.goto(base + '/watchlists');
    await page.getByLabel('Danh sách của bạn').waitFor();
    await page
      .getByLabel('Danh sách của bạn')
      .selectOption({ label: 'Temporary A' });
    await page.getByTestId('watch-VNM').waitFor();
    await page.getByRole('button', { name: 'Xóa VNM', exact: true }).click();
    await page.getByTestId('watch-VNM').waitFor({ state: 'detached' });
    const aPreferences = await a.db.from('user_settings').upsert({
      owner_id: a.id,
      scoring_preferences: {
        ...defaultSettings,
        grahamWeight: 70,
        buffettWeight: 30,
      },
    });
    const bPreferences = await b.db.from('user_settings').upsert({
      owner_id: b.id,
      scoring_preferences: {
        ...defaultSettings,
        grahamWeight: 30,
        buffettWeight: 70,
      },
    });
    assert(
      !aPreferences.error && !bPreferences.error,
      'Không tạo được preferences A/B',
    );
    const peer = await context.newPage();
    peer.on('pageerror', (e) => errors.push(e.message));
    await peer.goto(base + '/settings');
    await peer.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('input[type=number]')
          ?.value === '70',
    );
    await openAccountMenu(page);
    await page
      .getByRole('navigation', { name: 'Quản lý tài khoản' })
      .getByRole('button', { name: 'Đăng xuất', exact: true })
      .click();
    await page.waitForURL('**/login?next=%2Fwatchlists', { timeout: 30000 });
    // No reload in the second tab: SIGNED_OUT/storage must reset A to guest50/50.
    await peer.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('input[type=number]')
          ?.value === '50',
    );
    await page.getByLabel('Email', { exact: true }).fill(b.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(b.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL('**/watchlists', { timeout: 30000 });
    await peer.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('input[type=number]')
          ?.value === '30',
    );
    await openAccountMenu(page);
    await page
      .getByRole('navigation', { name: 'Quản lý tài khoản' })
      .getByRole('button', { name: 'Đăng xuất', exact: true })
      .click();
    await page.waitForURL('**/login?next=%2Fwatchlists', { timeout: 30000 });
    await peer.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('input[type=number]')
          ?.value === '50',
    );
    await peer.close();
    console.log(
      'AUTH SETTINGS BROWSER PASS: two tabs A70/30 → signout guest50/50 → B30/70 → guest50/50, peer never reloaded',
    );
    await page.goto(base + '/watchlists');
    await page.waitForURL('**/login?next=%2Fwatchlists');
    assert(errors.length === 0, 'Browser JS errors: ' + errors.join(';'));
    browserFailed = false;
    console.log(
      'BROWSER PHASE4 PASS: route guard, email login/logout, multiple lists, note/target persistence, add/remove, Top10 real, 390px, no JS errors',
    );
  } finally {
    if (debugPage && browserFailed) {
      // Diagnostics must not mask the original failure or prevent Auth-user cleanup.
      try {
        console.log('BROWSER DIAG PATH:', new URL(debugPage.url()).pathname);
        await mkdir('.cache/screenshots', { recursive: true });
        await debugPage.screenshot({
          path: '.cache/screenshots/phase4-failure.png',
          fullPage: true,
          timeout: 5000,
        });
      } catch {
        console.error('BROWSER DIAG unavailable; continuing cleanup.');
      }
    }
    await browser
      ?.close()
      .catch(() =>
        console.error('Browser cleanup failed; continuing Auth cleanup.'),
      );
    let failures = 0;
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) failures++;
    }
    assert(failures === 0, 'Không xóa được user tạm; cần cleanup');
    console.log('CLEANUP PASS: users tạm và dữ liệu riêng cascade đã xóa');
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'PHASE4 LIVE FAIL');
  process.exitCode = 1;
});
