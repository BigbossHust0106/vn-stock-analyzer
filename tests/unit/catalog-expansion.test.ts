import type { CatalogPage } from '../../web/lib/market-client';
import { afterEach, expect, it, vi } from 'vitest';
import { financialCatalog } from '../../worker/src/financial-catalog';
import { createClient } from '@supabase/supabase-js';
import { catalogResponse } from '../../worker/src/api/catalog';
import { default as worker } from '../../worker/src/index';
import { readFileSync } from 'node:fs';
import { parseConfigFileTextToJson } from 'typescript';
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('financial queue reads every catalog/snapshot page beyond 1,000 and never applies the old 35-symbol universe', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const u = new URL(String(input));
      calls.push(u.href);
      const offset = Number(u.searchParams.get('offset') ?? 0),
        limit = Number(u.searchParams.get('limit'));
      const total = u.pathname.endsWith('/stocks') ? 1207 : 1102;
      return Response.json(
        Array.from(
          { length: Math.max(0, Math.min(limit, total - offset)) },
          (_, i) =>
            u.pathname.endsWith('/stocks')
              ? {
                  id: 'id' + (offset + i),
                  symbol: 'X' + String(offset + i).padStart(4, '0'),
                }
              : {
                  stock_id: 'id' + (offset + i),
                  fetched_at: '2026-10-22T00:00:00Z',
                },
        ),
      );
    }),
  );
  const result = await financialCatalog(
    createClient(env.SUPABASE_URL, 'fixture-service', {
      auth: { persistSession: false },
    }),
  );
  expect(result.stocks).toHaveLength(1207);
  expect(result.stocks.at(-1)?.symbol).toBe('X1206');
  expect(result.fetched.size).toBe(1102);
  expect(result.fetched.has('id1101')).toBe(true);
  expect(calls).toHaveLength(6); // Three stock pages, three snapshot pages.
  expect(calls.every((u) => !u.includes('symbol=in.'))).toBe(true);
});
it('queue refuses incomplete DB reads rather than silently treating a failed later page as the whole market', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const u = new URL(String(input));
      return Number(u.searchParams.get('offset')) >= 500
        ? Response.json({ message: 'failure' }, { status: 403 })
        : Response.json(
            Array.from({ length: 500 }, (_, i) => ({
              id: String(i),
              symbol: 'ABC',
            })),
          );
    }),
  );
  await expect(
    financialCatalog(
      createClient(env.SUPABASE_URL, 'fixture-service', {
        auth: { persistSession: false },
      }),
    ),
  ).rejects.toThrow('đầy đủ');
});
it('catalog API paginates, filters on server, returns independent exact counts, and reads with public credentials only', async () => {
  const calls: { url: URL; key: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, key: new Headers(init?.headers).get('apikey') });
      const stocks = url.pathname.endsWith('/stocks'),
        head = init?.method === 'HEAD';
      const count = stocks
        ? 1522
        : url.searchParams.has('payload->annual')
          ? 32
          : 35;
      return new Response(
        head
          ? null
          : JSON.stringify([
              {
                symbol: 'XYZ',
                name: 'Synthetic',
                exchange: 'HNX',
                source: 'KBS',
                financial_snapshots: null,
                prices_current: null,
              },
            ]),
        {
          headers: {
            'content-type': 'application/json',
            'content-range': `0-0/${head ? count : 142}`,
          },
        },
      );
    }),
  );
  const r = await catalogResponse(
    new Request(
      'https://app.test/v1/catalog?financials=missing&page=2&exchange=HNX&q=XYZ',
    ),
    { ...env, SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-used' },
  );
  expect(r?.status).toBe(200);
  const body = (await r!.json()) as CatalogPage;
  expect(body.counts).toEqual({
    catalog: 1522,
    withAnnual: 32,
    withoutSnapshot: 1487,
    otherSnapshots: 3,
  });
  expect(body.total).toBe(142);
  expect(body.page).toBe(2);
  expect(body.pageSize).toBe(24);
  expect(body.data[0]).toMatchObject({
    symbol: 'XYZ',
    financial_state: 'missing',
    annual_years: 0,
  });
  const q = calls.find((x) => x.url.searchParams.get('offset') === '24')!.url;
  expect(q.searchParams.get('limit')).toBe('24');
  expect(q.searchParams.get('exchange')).toBe('eq.HNX');
  expect(q.searchParams.get('financial_snapshots')).toBe('is.null');
  expect(calls.every((c) => c.key === 'fixture-public')).toBe(true);
  expect(JSON.stringify(body)).not.toContain('must-not-be-used');
});
it.each([
  'page=0',
  'page=-1',
  'page=1e2',
  'page=1.5',
  'page=999999',
  'financials=guessed',
  'exchange=NYSE',
  'q=' + 'a'.repeat(81),
])(
  'rejects invalid catalog filters %s before any database query',
  async (query) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await catalogResponse(
          new Request('https://app.test/v1/catalog?' + query),
          env,
        )
      )?.status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('catalog failures do not fabricate counts or an empty complete list', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ message: 'unavailable' }, { status: 403 }),
    ),
  );
  const r = await catalogResponse(
    new Request('https://app.test/v1/catalog'),
    env,
  );
  expect(r?.status).toBe(502);
  expect(await r!.json()).not.toHaveProperty('counts');
});
it('registered all-day minute cron grows financial coverage on weekends without assuming a trading session', async () => {
  const module = await import('../../worker/src/financial-sync');
  const refresh = vi
    .spyOn(module, 'refreshStaleFinancials')
    .mockResolvedValue({ refreshed: ['GAS'], failed: [], pending: 1489 });
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  const pending: Promise<unknown>[] = [];
  worker.scheduled(
    {
      cron: '* * * * *',
      scheduledTime: Date.parse('2026-10-25T01:01:00Z'),
    } as ScheduledController,
    {},
    {
      waitUntil: (p) => {
        pending.push(p);
      },
    },
  );
  await Promise.all(pending);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(transport).not.toHaveBeenCalled();
  const config = parseConfigFileTextToJson(
    'wrangler.jsonc',
    readFileSync('wrangler.jsonc', 'utf8'),
  ).config;
  expect(config.triggers.crons).toContain('* * * * *');
  expect(config.triggers.crons).not.toContain('*/5 * * * *');
  expect(config.triggers.crons).toHaveLength(5);
});
it('daily membership reconcile runs on a weekend independently of the price/session jobs', async () => {
  const module = await import('../../worker/src/market-sync');
  const reconcile = vi
    .spyOn(module, 'refreshStockCatalog')
    .mockResolvedValue(1522);
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  const pending: Promise<unknown>[] = [];
  worker.scheduled(
    {
      cron: '* * * * *',
      scheduledTime: Date.parse('2026-10-25T00:02:00Z'),
    } as ScheduledController,
    {},
    {
      waitUntil: (p) => {
        pending.push(p);
      },
    },
  );
  await Promise.all(pending);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(transport).not.toHaveBeenCalled();
});
it('fresh catalog is not downloaded again; stale catalog is reconciled without a trading-session dependency', async () => {
  const { refreshCatalogIfStale } =
    await import('../../worker/src/market-sync');
  const { KbsProvider } = await import('../../modules/providers/kbs-provider');
  const api = await import('../../worker/src/api/market');
  const now = Date.parse('2026-10-22T06:00:00Z');
  let old = false;
  const provider = new KbsProvider();
  const source = vi.spyOn(provider, 'fetchStocks').mockResolvedValue(
    Array.from({ length: 105 }, (_, i) => ({
      symbol: 'X' + String(i).padStart(3, '0'),
      name: 'Synthetic ' + i,
      exchange: (['HOSE', 'HNX', 'UPCOM'] as const)[i % 3]!,
      source: 'KBS' as const,
      fetchedAt: new Date(now).toISOString(),
    })),
  );
  vi.spyOn(api, 'marketProviders').mockReturnValue({
    catalog: provider,
    history: provider,
    quotes: provider,
    profile: provider,
    fundamentals: provider,
  });
  const writes: unknown[] = [];
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      const u = String(input);
      paths.push(u);
      if (u.includes('catalog_sync_state'))
        return Response.json({
          observed_at: new Date(now - (old ? 24 : 1) * 3600000).toISOString(),
        });
      if (u.includes('reconcile_stock_catalog')) {
        writes.push(JSON.parse(String(init?.body)));
        return Response.json(null);
      }
      throw Error('No session/other reads permitted');
    }),
  );
  const db = createClient(env.SUPABASE_URL, 'fixture-service', {
    auth: { persistSession: false },
  });
  expect(await refreshCatalogIfStale(db, {}, now)).toEqual({
    state: 'skipped',
  });
  expect(source).not.toHaveBeenCalled();
  old = true;
  expect(await refreshCatalogIfStale(db, {}, now)).toEqual({
    state: 'ok',
    count: 105,
  });
  expect(source).toHaveBeenCalledTimes(1);
  expect(writes[0]).toMatchObject({
    complete: true,
    observed_at: '2026-10-22T06:00:00.000Z',
  });
  expect(paths.some((p) => p.includes('trading_sessions'))).toBe(false);
});
it('a truncated catalog from source never reaches membership reconciliation', async () => {
  const { refreshCatalogIfStale } =
    await import('../../worker/src/market-sync');
  const { KbsProvider } = await import('../../modules/providers/kbs-provider');
  const api = await import('../../worker/src/api/market');
  const provider = new KbsProvider();
  vi.spyOn(provider, 'fetchStocks').mockResolvedValue([]);
  vi.spyOn(api, 'marketProviders').mockReturnValue({
    catalog: provider,
    history: provider,
    quotes: provider,
    profile: provider,
    fundamentals: provider,
  });
  const fetcher = vi.fn(async () => Response.json(null));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    refreshCatalogIfStale(
      createClient(env.SUPABASE_URL, 'fixture-service', {
        auth: { persistSession: false },
      }),
      {},
      Date.now(),
    ),
  ).rejects.toThrow('không đầy đủ');
  expect(fetcher).toHaveBeenCalledTimes(1); // Only read the stamp; no write/deactivation.
});
