import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';
import { checkConnections } from '../../web/lib/connections';
import deployment from '../../config/public-deployment.json';

const publicKey = 'sb_publishable_aaaaaaaa';
const serviceKey = 'must-remain-private';
const workerUrl = 'https://worker.example.test';
const supabaseUrl = 'https://project.example.test';
afterEach(() => vi.unstubAllGlobals());

it('health và public-config có CORS; chỉ xuất publishable, không xuất service key', async () => {
  const health = await worker.fetch(new Request(`${workerUrl}/health`));
  expect(health.headers.get('Access-Control-Allow-Origin')).toBe('*');
  const response = await worker.fetch(
    new Request(`${workerUrl}/v1/public-config`),
    {
      SUPABASE_PUBLISHABLE_KEY: publicKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({
    supabaseUrl: deployment.supabaseUrl,
    supabasePublishableKey: publicKey,
  });
  expect(text).not.toContain(serviceKey);
});

it.each([undefined, 'sb_secret_aaaaaaaa', serviceKey])(
  'public-config từ chối biến publishable bị thiếu/đặt nhầm secret: %s',
  async (key) => {
    const response = await worker.fetch(
      new Request(`${workerUrl}/v1/public-config`),
      key ? { SUPABASE_PUBLISHABLE_KEY: key } : {},
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Cấu hình công khai chưa sẵn sàng',
    });
  },
);

function mockReadOnlyServices(
  options: {
    missingTable?: boolean;
    quote?: unknown;
    malformedHealth?: boolean;
    malformedConfig?: boolean;
  } = {},
) {
  const calls: { url: URL; headers: Headers; method: string }[] = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url, headers, method: init?.method ?? 'GET' });
    if (url.pathname === '/health')
      return Response.json(options.malformedHealth ? {} : { status: 'ok' });
    if (url.pathname === '/v1/public-config')
      return Response.json(
        options.malformedConfig
          ? { supabaseUrl }
          : { supabaseUrl, supabasePublishableKey: publicKey },
      );
    if (url.pathname === '/v1/quotes')
      return options.missingTable
        ? Response.json({ error: 'Read failed' }, { status: 502 })
        : Response.json({
            data:
              options.quote === undefined
                ? []
                : [{ symbol: 'ACB', prices_current: options.quote }],
          });
    if (url.pathname.startsWith('/rest/v1/')) {
      expect(headers.get('apikey')).toBe(publicKey);
      expect(headers.has('Authorization')).toBe(false);
      expect(url.searchParams.get('limit')).toBe('1');
      return options.missingTable
        ? Response.json({ code: 'PGRST205' }, { status: 404 })
        : Response.json([]);
    }
    throw new Error('Unexpected destination');
  });
  return { transport, calls };
}

it('đọc runtime config rồi kiểm tra 3 bảng công khai; dữ liệu rỗng không báo có giá', async () => {
  const { transport, calls } = mockReadOnlyServices();
  const results = await checkConnections({ workerUrl }, transport);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(results[2]?.message).toBe('Đã kết nối, chưa có snapshot ACB.');
  expect(
    calls
      .filter((c) => c.url.pathname.startsWith('/rest/'))
      .map((c) => c.url.pathname),
  ).toEqual([
    '/rest/v1/stocks',
    '/rest/v1/prices_current',
    '/rest/v1/trading_sessions',
  ]);
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});

it('thiếu migration là lỗi dữ liệu; health xanh không biến DB và quotes thành xanh', async () => {
  const { transport } = mockReadOnlyServices({ missingTable: true });
  const results = await checkConnections({ workerUrl }, transport);
  expect(results.map((r) => r.ok)).toEqual([true, false, false]);
  expect(results[1]?.message).toContain('áp dụng migration');
  expect(results[2]?.message).toContain('HTTP 502');
});

it('HTTP 200 với health/config sai schema vẫn bị từ chối', async () => {
  const { transport } = mockReadOnlyServices({
    malformedHealth: true,
    malformedConfig: true,
  });
  const results = await checkConnections({ workerUrl }, transport);
  expect(results.map((r) => r.ok)).toEqual([false, false, true]);
});

it.each([
  {},
  null,
  { fetched_at: 'invalid', last_price_vnd: 20450 },
  { fetched_at: '2026-10-12T08:30:00Z', last_price_vnd: null },
])('không suy ra snapshot hợp lệ từ dữ liệu thiếu: %j', async (quote) => {
  const { transport } = mockReadOnlyServices({ quote });
  const results = await checkConnections({ workerUrl }, transport);
  expect(results[2]?.message).toBe('Đã kết nối, chưa có snapshot ACB.');
});

it.each([
  { fetched_at: '2026-10-12T08:30:00Z', last_price_vnd: 20450 },
  [{ fetched_at: '2026-10-12T08:30:00Z', last_price_vnd: 20450 }],
])(
  'nhận snapshot object/array và nhắc kiểm tra thời gian: %j',
  async (quote) => {
    const { transport } = mockReadOnlyServices({ quote });
    const results = await checkConnections({ workerUrl }, transport);
    expect(results[2]?.message).toContain('xem fetched_at');
  },
);

it('không gửi private key từ cấu hình browser, không echo lỗi chứa credential', async () => {
  const { transport, calls } = mockReadOnlyServices();
  const results = await checkConnections(
    { workerUrl, supabaseUrl, supabasePublishableKey: serviceKey },
    transport,
  );
  expect(results[1]?.ok).toBe(false);
  expect(calls.some((c) => c.url.pathname.startsWith('/rest/'))).toBe(false);
  const failed = await checkConnections({ workerUrl }, async () => {
    throw new Error(`transport failed ${serviceKey}`);
  });
  expect(failed.every((r) => !r.ok)).toBe(true);
  expect(JSON.stringify(failed)).not.toContain(serviceKey);
});

it('URL hỏng/HTTP ngoài loopback không phát request và không throw ra UI', async () => {
  const transport = vi.fn<typeof fetch>();
  const results = await checkConnections(
    { workerUrl: 'http://example.test' },
    transport,
  );
  expect(results.every((r) => !r.ok)).toBe(true);
  expect(transport).not.toHaveBeenCalled();
});
