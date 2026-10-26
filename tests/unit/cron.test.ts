import { afterEach, expect, it, vi } from 'vitest';
import { ingest } from '../../worker/src/index';
import fixture from '../../fixtures/vps-getliststockdata-sample.json';
const timestamp = Date.parse('2026-10-12T08:30:00Z');
const env = {
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
};
afterEach(() => vi.unstubAllGlobals());

function operationalMock(
  url: string,
  init?: RequestInit,
): Response | undefined {
  if (url.includes('/rpc/claim_system_job'))
    return Response.json([{ id: 'fixture-job', generation: 1 }]);
  if (url.includes('/system_job_runs'))
    return new Response(null, { status: 204 });
  if (url.includes('/catalog_sync_state'))
    return Response.json({ observed_at: new Date().toISOString() });
  if (url.includes('/watchlist_alert_rules')) return Response.json([]);
  if (url.includes('/api_health'))
    return init?.method === 'POST'
      ? new Response(null, { status: 201 })
      : Response.json(null);
  // A health probe is separate from market ingestion and never writes quotes.
  if (url.startsWith('https://bgapidatafeed.vps.com.vn/'))
    return Response.json([fixture[0]]);
  return undefined;
}
function mockServices(
  options: { closed?: boolean; empty?: boolean; writeFails?: boolean } = {},
) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push({
        url,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as unknown)
            : null,
      });
      if (url.startsWith('https://bgapidatafeed.vps.com.vn/'))
        return Response.json([fixture[0]]);
      if (url.includes('/trading_sessions'))
        return Response.json({
          session_date: '2026-10-12',
          is_open: options.closed !== false,
          closes_at: '2026-10-12T08:00:00Z',
        });
      if (url.includes('/stocks'))
        return Response.json(options.empty ? [] : [{ symbol: 'ACB' }]);
      if (url.includes('/rpc/ingest_current_quotes'))
        return options.writeFails
          ? Response.json(
              { message: 'fixture database write error' },
              { status: 400 },
            )
          : Response.json(null);
      if (url.includes('/system_status'))
        return new Response(null, { status: 201 });
      throw new Error('Unexpected destination in mock');
    }),
  );
  return calls;
}
it('Cron dùng quote hiện tại, VND và volume raw, ghi trạng thái sau RPC thành công', async () => {
  const calls = mockServices();
  await ingest(env, timestamp);
  const rpc = calls.find((c) => c.url.includes('/rpc/'))!;
  expect(rpc.body).toMatchObject({
    rows: [
      {
        symbol: 'ACB',
        reference_vnd: 20150,
        ceiling_vnd: 21550,
        floor_vnd: 18750,
        bid3_price_vnd: 20350,
        last_volume_raw: 1440,
        lot_raw: 796910,
      },
    ],
  });
  expect(calls.at(-1)!.url).toContain('/system_status');
  expect(calls.some((c) => c.url.includes('prices_daily'))).toBe(false);
});
it('Ngày không giao dịch không gọi VPS, không ghi success', async () => {
  const calls = mockServices({ closed: false });
  await ingest(env, timestamp);
  expect(calls).toHaveLength(1);
});
it('Danh mục rỗng không được ghi success', async () => {
  const calls = mockServices({ empty: true });
  await expect(ingest(env, timestamp)).rejects.toThrow('Danh mục chưa có mã');
  expect(calls.some((c) => c.url.includes('system_status'))).toBe(false);
});
it('RPC lỗi không ghi success, không suy ra lịch sử', async () => {
  const calls = mockServices({ writeFails: true });
  await expect(ingest(env, timestamp)).rejects.toThrow(
    'Không ghi được snapshot',
  );
  expect(calls.some((c) => c.url.includes('system_status'))).toBe(false);
});

it.each([
  ['closed', false, '2026-10-12T08:00:00Z'],
  ['missing', null, null],
  ['before-close', true, '2026-10-12T10:00:00Z'],
])(
  'Review4/8 cron16:00 %s không ingest catalog/quotes/BCTC; vẫn ghi log',
  async (_label, isOpen, close) => {
    const { default: worker } = await import('../../worker/src/index');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/trading_sessions'))
          return Response.json(
            isOpen === null
              ? null
              : {
                  session_date: '2026-10-12',
                  is_open: isOpen,
                  closes_at: close,
                },
          );
        const operational = operationalMock(url, init);
        if (operational) return operational;
        throw new Error('Cron should not ingest market data');
      }),
    );
    const jobs: Promise<unknown>[] = [];
    worker.scheduled(
      {
        cron: '0 9 * * 1-5',
        scheduledTime: Date.parse('2026-10-12T09:00:00Z'),
      } as ScheduledController,
      env,
      {
        waitUntil: (p) => {
          jobs.push(p);
        },
      },
    );
    await Promise.all(jobs);
    expect(calls.filter((u) => u.includes('/trading_sessions'))).toHaveLength(
      1,
    );
    expect(
      calls.some((u) =>
        /ingest_current_quotes|reconcile_stock_catalog|financial_snapshots/.test(
          u,
        ),
      ),
    ).toBe(false);
    expect(calls.some((u) => u.includes('/system_job_runs'))).toBe(true);
  },
);
it('Review4 cron chưa khai báo không đồng bộ ngoài ý muốn', async () => {
  const { default: worker } = await import('../../worker/src/index');
  const waitUntil = vi.fn();
  worker.scheduled(
    {
      cron: '7 * * * *',
      scheduledTime: Date.parse('2026-10-12T09:00:00Z'),
    } as ScheduledController,
    env,
    { waitUntil },
  );
  expect(waitUntil).not.toHaveBeenCalled();
});
it.each(['*/5 2-8 * * 1-5', '15 8 * * 1-5'])(
  'Review4/8: cron Phase4 %s không ingest ngày nghỉ; vẫn ghi log',
  async (cron) => {
    const { default: worker } = await import('../../worker/src/index');
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const operational = operationalMock(String(input), init);
      if (operational) return operational;
      return Response.json({
        session_date: '2026-10-12',
        is_open: false,
        closes_at: null,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const jobs: Promise<unknown>[] = [];
    worker.scheduled(
      { cron, scheduledTime: timestamp } as ScheduledController,
      env,
      {
        waitUntil: (p) => {
          jobs.push(p);
        },
      },
    );
    await Promise.all(jobs);
    const urls = fetcher.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/trading_sessions'))).toHaveLength(1);
    expect(
      urls.some((u) =>
        /ingest_current_quotes|reconcile_stock_catalog|financial_snapshots/.test(
          u,
        ),
      ),
    ).toBe(false);
  },
);
it('Phần 7: cron cảnh báo riêng kiểm tra VPS, không ingest giá, email thiếu cấu hình là skipped', async () => {
  const { default: worker } = await import('../../worker/src/index');
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.body) writes.push({ url, body: JSON.parse(String(init.body)) });
      const response = operationalMock(url, init);
      if (response) return response;
      // Bước BCTC độc lập lịch phiên chạy cuối; universe rỗng => không gọi nguồn.
      if (
        [
          '/rest/v1/stocks?',
          '/financial_snapshots?',
          '/financial_report_backups?',
        ].some((path) => url.includes(path)) &&
        !init?.body
      )
        return Response.json([]);
      throw Error('Maintenance must not ingest market data');
    }),
  );
  const jobs: Promise<unknown>[] = [];
  worker.scheduled(
    { cron: '*/5 * * * *', scheduledTime: timestamp } as ScheduledController,
    env,
    {
      waitUntil: (p) => {
        jobs.push(p);
      },
    },
  );
  await Promise.all(jobs);
  expect(writes.some((w) => w.url.includes('ingest_current_quotes'))).toBe(
    false,
  );
  expect(
    writes.filter((w) => w.url.includes('claim_system_job')).map((w) => w.body),
  ).not.toContainEqual(expect.objectContaining({ task: 'email' }));
  expect(writes.find((w) => w.url.includes('api_health'))?.body).toMatchObject({
    provider: 'VPS',
    state: 'ok',
  });
});
