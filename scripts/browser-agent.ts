import { chromium, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authenticateBrowser } from './browser-auth';
import { agentResponse } from '../worker/src/api/agent';
import type { AgentPlan } from '../modules/agent/plan';
const base = process.env.MARKET_APP_URL || 'http://127.0.0.1:8878';
const config = (await (
  await fetch(
    'https://vn-stock-analyzer.manhhuong.workers.dev/v1/public-config',
  )
).json()) as { supabaseUrl: string; supabasePublishableKey: string };
const browser = await chromium.launch({ headless: true });
let cleanup: (() => Promise<void>) | undefined;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let userDb: SupabaseClient | undefined,
    inferences = 0;
  const name = 'Agent browser fixture ' + Date.now();
  await page.route('**/v1/agent', async (route) => {
    const req = route.request();
    const headers = await req.allHeaders();
    const bearer = headers.authorization;
    if (bearer)
      userDb = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: bearer } },
      });
    const r = await agentResponse(
      new Request(req.url(), {
        method: req.method(),
        headers,
        ...(req.postData() ? { body: req.postData()! } : {}),
      }),
      {
        SUPABASE_URL: config.supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: config.supabasePublishableKey,
        AI: {
          run: async (_model, input) => {
            expect(_model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
            inferences++;
            const payload = JSON.parse(
              input.messages[1]!.content.split('\n/no_think')[0]!,
            );
            const text = payload.messages.at(-1) as string;
            const plan: AgentPlan = {
              intent: 'help',
              symbols: [],
              listId: null,
              name: null,
              notes: null,
              targetVnd: null,
              alertId: null,
              kind: null,
              lowerVnd: null,
              upperVnd: null,
              enabled: null,
            };
            if (text.startsWith('Tạo')) {
              plan.intent = 'create_list';
              plan.name = name;
            } else if (text.startsWith('Thêm')) {
              plan.intent = 'add_stock';
              plan.symbols = ['FPT'];
              plan.listId = payload.context.lists.find(
                (l: { name: string }) => l.name === name,
              ).id;
            } else {
              plan.intent = 'create_alert';
              plan.symbols = ['FPT'];
              plan.listId = payload.context.lists.find(
                (l: { name: string }) => l.name === name,
              ).id;
              plan.kind = 'stop_loss';
              plan.lowerVnd = 55000;
            }
            return { response: plan };
          },
        },
      },
    );
    await route.fulfill({
      status: r!.status,
      headers: Object.fromEntries(r!.headers),
      body: await r!.text(),
    });
  });
  cleanup = await authenticateBrowser(page, base, '/agent');
  await expect(
    page.getByRole('heading', {
      name: 'Hỏi dữ liệu. Hiểu chiến lược. Quản lý theo dõi.',
    }),
  ).toBeVisible();
  async function ask(text: string) {
    await page.getByLabel('Yêu cầu của bạn', { exact: true }).fill(text);
    await page
      .getByRole('button', { name: 'Gửi yêu cầu', exact: true })
      .click();
    await expect(page.getByTestId('agent-proposal').last()).toBeVisible({
      timeout: 30000,
    });
  }
  await ask('Tạo danh sách ' + name);
  expect(
    (await userDb!.from('watchlists').select('id').eq('name', name)).data,
  ).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Xác nhận thao tác', exact: true })
    .click();
  await expect(
    page.getByText('Đã áp dụng thao tác.', { exact: true }),
  ).toHaveCount(1);
  const lists = await userDb!.from('watchlists').select('id').eq('name', name);
  expect(lists.data).toHaveLength(1);
  const list = lists.data![0]!.id;
  await ask('Thêm FPT vào ' + name);
  expect(
    (
      await userDb!
        .from('watchlist_items')
        .select('stock_id')
        .eq('watchlist_id', list)
    ).data,
  ).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Xác nhận thao tác', exact: true })
    .click();
  await expect(
    page.getByText('Đã áp dụng thao tác.', { exact: true }),
  ).toHaveCount(2);
  expect(
    (
      await userDb!
        .from('watchlist_items')
        .select('stock_id')
        .eq('watchlist_id', list)
    ).data,
  ).toHaveLength(1);
  await ask('Cảnh báo cắt lỗ FPT trong ' + name + ' dưới55000 VND');
  await expect(page.getByTestId('agent-proposal').last()).toContainText(
    '55.000 VND',
  );
  expect(
    (
      await userDb!
        .from('watchlist_alert_rules')
        .select('id')
        .eq('watchlist_id', list)
    ).data,
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Hủy đề xuất', exact: true }).click();
  await expect(
    page.getByText('Đề xuất đã hủy.', { exact: true }),
  ).toBeVisible();
  expect(
    (
      await userDb!
        .from('watchlist_alert_rules')
        .select('id')
        .eq('watchlist_id', list)
    ).data,
  ).toHaveLength(0);
  expect(inferences).toBe(3);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Xóa hội thoại trên thiết bị' })
    .click();
  await expect(page.getByTestId('agent-proposal')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByLabel('Yêu cầu của bạn')).toBeVisible();
  console.log(
    'AGENT BROWSER PASS: real Supabase Auth/RPC/RLS, mocked AI interpretation only; preview does not mutate; confirm list/add stock; cancel55000 VND stop-loss; no duplicate model calls;390/1440px; clear conversation; no JS errors.',
  );
} finally {
  await browser.close();
  await cleanup?.();
}
