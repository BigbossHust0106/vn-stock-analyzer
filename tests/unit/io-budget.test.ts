import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { financialTurn } from '../../worker/src/financial-catalog';
import { refreshStaleFinancials } from '../../worker/src/financial-sync';
import { ioPolicy } from '../../modules/market/io-policy';
import { changedHistory } from '../../modules/market/history-delta';
import type { DailyBar } from '../../modules/providers/data-provider';
import { publicReadCache } from '../../worker/src/api/public-cache';
import { catalogResponse } from '../../worker/src/api/catalog';
import { runScheduledJobs } from '../../worker/src/jobs/scheduled';
import { collectNews } from '../../worker/src/news/sync';
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('a 200,000-symbol financial queue still returns only two metadata records and no full payloads', async () => {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const u = new URL(String(input));
      calls.push(u);
      return Response.json(
        u.pathname.endsWith('catalog_sync_state')
          ? { row_count: 200000 }
          : [
              {
                id: 'id1001',
                symbol: 'X1001',
                financial_snapshots: { fetched_at: '2026-10-26T00:00:00Z' },
              },
            ],
      );
    }),
  );
  const result = await financialTurn(
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    }),
    1001 * 5 * 60000,
  );
  expect(result?.symbol).toBe('X1001');
  expect(calls).toHaveLength(2);
  expect(calls[1]!.searchParams.get('offset')).toBe('1001');
  expect(calls[1]!.searchParams.get('limit')).toBe('1');
  expect(
    calls.every((u) => !u.searchParams.get('select')?.includes('payload')),
  ).toBe(true);
});
it('fresh BCTC turn does exactly two reads and zero source/DB writes, even outside the old 35-symbol set', async () => {
  const now = Date.parse('2026-10-26T00:00:00Z'),
    calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('catalog_sync_state'))
        return Response.json({ row_count: 2000 });
      if (url.includes('/stocks?'))
        return Response.json([
          {
            id: 'id-new',
            symbol: 'NEW',
            financial_snapshots: {
              fetched_at: new Date(now - 6 * 86400000).toISOString(),
            },
          },
        ]);
      throw Error('No other reads/writes permitted');
    }),
  );
  expect(await refreshStaleFinancials(env, now)).toEqual({
    refreshed: [],
    failed: [],
    pending: null,
  });
  expect(calls).toHaveLength(2);
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  expect(ioPolicy.financialMaxAgeMs).toBe(7 * 86400000);
});
it('a complete ring covers >1,000 symbols; a failed slot does not freeze the next slot', async () => {
  const count = 1519;
  let expected = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith('catalog_sync_state'))
        return Response.json({ row_count: count });
      const slot = Number(u.searchParams.get('offset'));
      expect(slot).toBe(expected);
      return Response.json([
        {
          id: 'id' + slot,
          symbol: 'X' + String(slot).padStart(4, '0'),
          financial_snapshots: null,
        },
      ]);
    }),
  );
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    }),
    seen = new Set<string>();
  // Independent sweep over slots 0..1518, one five-minute tick per slot.
  for (let slot = 0; slot < count; slot++) {
    expected = slot;
    seen.add((await financialTurn(db, slot * 300000))!.id);
  }
  expect(seen.size).toBe(1519);
  expect(seen.has('id1518')).toBe(true);
  expected = 0;
  expect((await financialTurn(db, count * 300000))!.id).toBe('id0');
});
const bar: DailyBar = {
  symbol: 'VNM',
  sessionDate: '2026-10-20',
  openVnd: 20,
  highVnd: 22,
  lowVnd: 19,
  closeVnd: 21,
  volumeReported: 100,
  volumeUnit: 'shares',
  source: 'KBS',
  priceBasis: 'unverified',
  isFinal: false,
  fetchedAt: '2026-10-21T00:00:00Z',
};
it('history retransmission ignores observation-time-only differences but keeps new sessions and real corrections', () => {
  const newer = { ...bar, fetchedAt: '2026-10-26T00:00:00Z' };
  expect(changedHistory([newer], [bar])).toEqual([]);
  const correction = { ...newer, closeVnd: 22 },
    extra = { ...newer, sessionDate: '2026-10-21' };
  expect(changedHistory([newer, correction, extra], [bar])).toEqual([
    correction,
    extra,
  ]);
  expect(bar.closeVnd).toBe(21);
  expect(bar.fetchedAt).toBe('2026-10-21T00:00:00Z');
});
function cacheHarness() {
  const stored = new Map<string, Response>();
  const put = vi.fn(async (req: Request, response: Response) => {
    stored.set(req.url, response);
  });
  const open = vi.fn(async () => ({
    match: async (req: Request) => stored.get(req.url)?.clone(),
    put,
  }));
  vi.stubGlobal('caches', { open });
  return { open, put };
}
it('public cache coalesces an 8-request burst into one backend read and cached timestamps remain unchanged', async () => {
  const { put } = cacheHarness();
  let release!: () => void;
  const ready = new Promise<void>((r) => {
    release = r;
  });
  const load = vi.fn(async () => {
    await ready;
    return Response.json(
      { asOf: '2026-10-26T00:00:00Z' },
      { headers: { 'Cache-Control': 'public, max-age=120' } },
    );
  });
  const jobs: Promise<unknown>[] = [];
  const context = {
    waitUntil: (p: Promise<unknown>) => {
      jobs.push(p);
    },
  };
  const requests = Array.from({ length: 8 }, () =>
    publicReadCache(new Request('https://app.test/v1/catalog'), context, load),
  );
  await Promise.resolve();
  release();
  const replies = await Promise.all(requests);
  await Promise.all(jobs);
  expect(load).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(1);
  for (const r of replies)
    expect(await r.json()).toEqual({ asOf: '2026-10-26T00:00:00Z' });
  const hit = await publicReadCache(
    new Request('https://app.test/v1/catalog'),
    context,
    load,
  );
  expect(hit.headers.get('X-Data-Cache')).toBe('HIT');
  expect(load).toHaveBeenCalledTimes(1);
});
it('Auth, cookies, account paths, explicit refresh and errors never populate shared cache', async () => {
  const { open, put } = cacheHarness();
  const load = vi.fn(async () =>
    Response.json({ error: 'unavailable' }, { status: 503 }),
  );
  const context = { waitUntil: () => {} };
  for (const req of [
    new Request('https://app.test/v1/catalog', {
      headers: { Authorization: 'Bearer fixture' },
    }),
    new Request('https://app.test/v1/catalog', {
      headers: { Cookie: 'session=fixture' },
    }),
    new Request('https://app.test/v1/watchlists'),
    new Request('https://app.test/v1/catalog?refresh=1'),
  ])
    await publicReadCache(req, context, load);
  expect(open).not.toHaveBeenCalled();
  await publicReadCache(
    new Request('https://app.test/v1/catalog'),
    context,
    load,
  );
  expect(put).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(5);
});
it('catalog pagination/search reuse global counters rather than recounting all tables per query', async () => {
  const methods: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      return new Response(method === 'HEAD' ? null : JSON.stringify([]), {
        headers: {
          'content-type': 'application/json',
          'content-range': '0-0/1519',
        },
      });
    }),
  );
  await catalogResponse(new Request('https://app.test/v1/catalog?page=1'), env);
  await catalogResponse(new Request('https://app.test/v1/catalog?page=2'), env);
  expect(methods.filter((m) => m === 'HEAD')).toHaveLength(3);
  expect(methods.filter((m) => m === 'GET')).toHaveLength(2);
});
it.each([
  ['* * * * *', '2026-10-26T02:01:00Z'],
  ['*/30 * * * *', '2026-10-26T02:30:00Z'],
  ['* 2-8 * * 1-5', '2026-10-26T05:00:00Z'],
])(
  'obsolete/off-session callback %s stops before any database IO',
  async (cron, time) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await runScheduledJobs(cron, Date.parse(time), env, async () => {});
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('broad rankings have a hard budget of two recalculations per observed trading hour, rather than twelve', async () => {
  const runner = await import('../../worker/src/jobs/runner');
  vi.spyOn(runner, 'runJob').mockImplementation(
    async (_db, _job, _stamp, work) => work(),
  );
  vi.spyOn(
    await import('../../worker/src/quote-sampling'),
    'sampleQuotes',
  ).mockResolvedValue({ state: 'ok' });
  const rank = vi
    .spyOn(await import('../../worker/src/ranking-sync'), 'syncRankings')
    .mockResolvedValue();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (let minute = 0; minute < 60; minute += 5)
    await runScheduledJobs(
      '* 2-8 * * 1-5',
      Date.parse('2026-10-26T02:00:00Z') + minute * 60000,
      env,
      async () => {},
    );
  expect(rank).toHaveBeenCalledTimes(2);
  expect(fetcher).not.toHaveBeenCalled();
});
it('2,000 catalog symbols and one issuer article produce one news-score row, not 2,000 empty score writes', async () => {
  const scores: unknown[][] = [];
  const stocks = [
    { id: 'dpr', symbol: 'DPR', name: 'Cao su Đồng Phú', sector: null },
    ...Array.from({ length: 1999 }, (_, i) => ({
      id: 'noise' + i,
      symbol: 'X' + String(i).padStart(4, '0'),
      name: 'Synthetic ' + i,
      sector: null,
    })),
  ];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'db.example.test') {
      if (url.pathname.includes('claim_news_ingestion'))
        return Response.json(true);
      if (url.pathname.includes('release_news_ingestion'))
        return Response.json(null);
      if (url.pathname.endsWith('/stocks')) {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return Response.json(stocks.slice(offset, offset + 1000));
      }
      if (
        url.pathname.endsWith('/news_feed_articles') &&
        (!init?.method || init.method === 'GET')
      )
        return Response.json([]);
      if (url.pathname.endsWith('/news_scores') && init?.body)
        scores.push(JSON.parse(String(init.body)));
      return new Response(null, {
        status: init?.method === 'DELETE' ? 204 : 201,
      });
    }
    if (url.pathname === '/robots.txt')
      return new Response('User-agent: *\nAllow: /');
    return new Response(
      `<rss version="2.0"><channel><item><title>DPR công bố lợi nhuận năm</title><link>${url.origin}/dpr-test</link><pubDate>Mon, 26 Oct 2026 00:00:00 GMT</pubDate><description>DPR công bố báo cáo.</description></item></channel></rss>`,
    );
  });
  vi.stubGlobal('fetch', transport);
  await collectNews(
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    }),
    { NEWS_RSS_PERMISSION: 'personal-nonprofit' },
    Date.parse('2026-10-26T01:00:00Z'),
    transport,
  );
  expect(scores.flat()).toHaveLength(1);
  expect(scores.flat()[0]).toMatchObject({ stock_id: 'dpr', score: null });
});

it('emergency bulk pause returns before DB/news work and leaves the live quote path separate', async () => {
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  for (const cron of ['0 * * * *', '*/30 * * * *', '0 9 * * 1-5'])
    await runScheduledJobs(
      cron,
      Date.parse('2026-10-26T09:00:00Z'),
      { ...env, PAUSE_BULK_SYNC: 'true' },
      async () => {},
    );
  expect(transport).not.toHaveBeenCalled();
});
