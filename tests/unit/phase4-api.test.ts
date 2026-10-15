import { rankStock } from '../../modules/scoring/rankings';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-used-for-private-reads',
};
afterEach(() => vi.unstubAllGlobals());
it('Route watchlist yêu cầu đăng nhập và không cache', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const response = await worker.fetch(
    new Request('https://app.test/v1/watchlists'),
    env,
  );
  expect(response.status).toBe(401);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(fetcher).not.toHaveBeenCalled();
});
it('JWT bị từ chối không truy vấn bảng cá nhân', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ message: 'invalid token' }, { status: 401 }),
    );
  vi.stubGlobal('fetch', fetcher);
  const response = await worker.fetch(
    new Request('https://app.test/v1/watchlists', {
      headers: { Authorization: 'Bearer bad.token.value' },
    }),
    env,
  );
  expect(response.status).toBe(401);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('Private API xác thực getUser và dùng JWT người dùng + public key, không service_role', async () => {
  const calls: { url: string; auth: string | null; key: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input),
        headers = new Headers(init?.headers);
      calls.push({
        url,
        auth: headers.get('Authorization'),
        key: headers.get('apikey'),
      });
      return url.includes('/auth/v1/user')
        ? Response.json({
            id: '10000000-0000-4000-8000-000000000001',
            aud: 'authenticated',
            email: 'temporary@example.test',
          })
        : Response.json([{ id: 'list', name: 'Own list' }]);
    }),
  );
  const response = await worker.fetch(
    new Request('https://app.test/v1/watchlists?owner_id=forged', {
      headers: { Authorization: 'Bearer test.user.jwt' },
    }),
    env,
  );
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(
    calls.every(
      (c) =>
        c.auth === 'Bearer test.user.jwt' && c.key === 'sb_publishable_test',
    ),
  ).toBe(true);
  expect(calls[1]!.url).not.toContain('forged');
});
it('Bộ lọc ranking sai bị từ chối trước DB; cấu hình thiếu 503', async () => {
  vi.stubGlobal('fetch', vi.fn());
  for (const query of [
    'horizon=year',
    'newsWeight=NaN',
    'newsWeight=0.31',
    'newsWeight=-0.1',
    'exchange=NYSE',
    'minCap=-1',
    'minCap=NaN',
    'minCap=100&maxCap=10',
    'sector=',
    'sector=' + 'a'.repeat(121),
  ])
    expect(
      (
        await worker.fetch(
          new Request('https://app.test/v1/rankings?' + query),
          env,
        )
      ).status,
    ).toBe(400);
  expect(
    (await worker.fetch(new Request('https://app.test/v1/rankings'))).status,
  ).toBe(503);
});
it('Ranking public dùng RPC nhận bộ lọc trước limit và trả run/sector', async () => {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.includes('ranking_news_inputs')) {
        const row = rankStock({
          stockId: 'stock',
          financials: null,
          priceVnd: null,
          referenceVnd: null,
          quoteFetchedAt: null,
          bars: [],
          events: [],
          asOf: '2026-10-14T00:00:00Z',
        })[0]!;
        return Response.json([
          {
            stock_id: 'stock',
            symbol: 'VNM',
            score: null,
            explanation: row.explanation,
          },
        ]);
      }
      if (url.includes('ranking_runs'))
        return Response.json([{ as_of: '2026-10-14', universe_count: 20 }]);
      return Response.json([{ sector: 'Thực phẩm' }, { sector: 'Thực phẩm' }]);
    }),
  );
  const response = await worker.fetch(
    new Request(
      'https://app.test/v1/rankings?horizon=quarter&exchange=HOSE&sector=Th%E1%BB%B1c%20ph%E1%BA%A9m&minCap=100',
    ),
    env,
  );
  expect(response.status).toBe(200);
  expect(
    calls.find((c) => c.url.includes('ranking_news_inputs'))?.body,
  ).toEqual({
    period: 'quarter',
    market: 'HOSE',
    industry: 'Thực phẩm',
    min_cap: 100,
    max_cap: null,
  });
  expect(await response.json()).toMatchObject({
    sectors: ['Thực phẩm'],
    data: [],
    excluded: [{ symbol: 'VNM', position: null }],
  });
});
it('Giờ cron mới được phân luồng, thiếu key báo lỗi thay vì success', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let task: Promise<unknown> | undefined;
  worker.scheduled(
    { scheduledTime: Date.now(), cron: '*/5 2-8 * * 1-5', noRetry: () => {} },
    {},
    {
      waitUntil: (p) => {
        task = p;
      },
    },
  );
  await expect(task).rejects.toThrow('Cron thất bại; xem nhật ký hệ thống.');
  vi.restoreAllMocks();
});

it('Cron intraday danh mục rỗng không gọi nguồn giá/ghi success', async () => {
  const { tradingSync } = await import('../../worker/src/trading-sync');
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('trading_sessions'))
        return Response.json({
          session_date: '2026-10-14',
          is_open: true,
          closes_at: '2026-10-14T08:00:00Z',
        });
      if (url.includes('stocks')) return Response.json([]);
      throw new Error('Unexpected request');
    }),
  );
  await expect(
    tradingSync(env, Date.parse('2026-10-14T02:00:00Z')),
  ).rejects.toThrow('Danh mục giao dịch rỗng');
  expect(
    calls.some(
      (url) => url.includes('system_status') || url.includes('vps.com.vn'),
    ),
  ).toBe(false);
});
it('Danh sách chưa đủ bằng chứng ưu tiên coverage0.8 trước0.2, không biến thành Top10', async () => {
  const explanation = rankStock({
    stockId: 'synthetic',
    financials: null,
    priceVnd: null,
    referenceVnd: null,
    quoteFetchedAt: null,
    bars: [],
    events: [],
    asOf: '2026-10-15T00:00:00Z',
  })[0]!.explanation;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const u = String(input);
      if (u.includes('ranking_news_inputs'))
        return Response.json([
          {
            stock_id: 'low',
            symbol: 'AA1',
            score: 90,
            explanation: { ...explanation, coverage: 0.2 },
          },
          {
            stock_id: 'high',
            symbol: 'ZZ1',
            score: 10,
            explanation: { ...explanation, coverage: 0.8 },
          },
        ]);
      return Response.json([]);
    }),
  );
  const r = await worker.fetch(
    new Request('https://app.test/v1/rankings?horizon=day&newsWeight=0'),
    env,
  );
  expect(r.status).toBe(200);
  const d = (await r.json()) as {
    data: unknown[];
    excluded: { symbol: string; position: null }[];
  };
  expect(d.data).toEqual([]);
  expect(d.excluded.map((s) => s.symbol)).toEqual(['ZZ1', 'AA1']);
  expect(d.excluded.every((s) => s.position === null)).toBe(true);
});
