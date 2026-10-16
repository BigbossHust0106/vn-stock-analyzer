import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/vps-getliststockdata-sample.json';
import { liveQuotes } from '../../worker/src/live-quotes';
import { quotesResponse } from '../../worker/src/api/quotes';
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('coalesces concurrent batches; 5s cache expires and returns new source price, not a new timestamp on old data', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T03:00:00Z'));
  let price = 20.45;
  const fetcher = vi.fn(async () =>
    Response.json([{ ...fixture[0], lastPrice: price }]),
  );
  vi.stubGlobal('fetch', fetcher);
  const [a, b] = await Promise.all([liveQuotes(['ACB']), liveQuotes(['ACB'])]);
  // Verified ACB fixture20.45 *1000=20450 VND, independent of cache implementation.
  expect(a[0]!.lastPriceVnd).toBe(20450);
  expect(b).toEqual(a);
  expect(fetcher).toHaveBeenCalledTimes(1);
  price = 21;
  await vi.advanceTimersByTimeAsync(5001);
  const c = await liveQuotes(['ACB']);
  expect(c[0]!.lastPriceVnd).toBe(21000);
  expect(c[0]!.exchangeTimestamp).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(c[0]!.fetchedAt).not.toBe(a[0]!.fetchedAt);
});
it('provider failure has a 10s cooldown, does not poison future refreshes or retry a 503 in a browser request', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T03:00:00Z'));
  const fetcher = vi.fn(
    async () => new Response('unavailable', { status: 503 }),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(liveQuotes(['ACB'])).rejects.toThrow('HTTP 503');
  await expect(liveQuotes(['ACB'])).rejects.toThrow('gián đoạn');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => Response.json([fixture[0]]));
  await vi.advanceTimersByTimeAsync(10001);
  expect((await liveQuotes(['ACB']))[0]!.lastPriceVnd).toBe(20450);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('public quote request fetches only active catalog symbols, persists VND, and never uses writer credential to read', async () => {
  const calls: { url: string; key: string | null; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const u = String(input);
      calls.push({
        url: u,
        key: new Headers(init?.headers).get('apikey'),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (u.includes('/stocks?')) {
        expect(u).toContain('active=eq.true');
        return Response.json([{ symbol: 'ACB', prices_current: null }]);
      }
      if (u.startsWith('https://bgapidatafeed.vps.com.vn/')) {
        expect(u.endsWith('/ACB')).toBe(true);
        return Response.json([fixture[0]]);
      }
      if (u.includes('/rpc/ingest_current_quotes')) return Response.json(null);
      throw Error('Unexpected request');
    }),
  );
  const r = (await quotesResponse(
    new Request('https://app.test/v1/quotes?symbols=ACB,ZZZ'),
    env,
  ))!;
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(await r.json()).toMatchObject({
    data: [
      {
        symbol: 'ACB',
        prices_current: { last_price_vnd: 20450, total_volume_shares: 7969100 },
      },
    ],
    refresh: {
      state: 'source_response',
      persisted: true,
      sourceTimestamp: null,
      sessionVerified: false,
    },
  });
  expect(calls.find((c) => c.url.includes('/stocks?'))!.key).toBe(
    'sb_publishable_test',
  );
  expect(calls.find((c) => c.url.includes('/rpc/'))).toMatchObject({
    key: 'local-test-only',
    body: { rows: [{ last_price_vnd: 20450, lot_raw: 796910 }] },
  });
});
it('source down preserves old price AND original fetched_at; no fake success or database overwrite', async () => {
  const saved = {
    last_price_vnd: 20000,
    reference_vnd: 20150,
    fetched_at: '2026-10-14T08:00:00Z',
  };
  const writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const u = String(input);
      if (u.includes('/stocks?'))
        return Response.json([{ symbol: 'ACB', prices_current: saved }]);
      if (u.includes('bgapidatafeed'))
        return new Response('error', { status: 503 });
      writes.push(u);
      throw Error('Must not write on failure');
    }),
  );
  const r = (await quotesResponse(
    new Request('https://app.test/v1/quotes?symbols=ACB'),
    env,
  ))!;
  expect(await r.json()).toMatchObject({
    data: [{ symbol: 'ACB', prices_current: saved }],
    refresh: {
      state: 'source_unavailable',
      persisted: false,
      sourceTimestamp: null,
      sessionVerified: false,
    },
  });
  expect(writes).toEqual([]);
});
it('validates input before upstream calls, unknown catalog symbols do not hit provider', async () => {
  const fetcher = vi.fn(async () => Response.json([]));
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await quotesResponse(
      new Request('https://app.test/v1/quotes?symbols=../'),
      env,
    ))!.status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const r = (await quotesResponse(
    new Request('https://app.test/v1/quotes?symbols=ZZZ'),
    env,
  ))!;
  expect(await r.json()).toMatchObject({
    data: [],
    refresh: { state: 'unavailable' },
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('browser keeps newest valid sample when a later failed refresh falls back to an older DB row', async () => {
  const { mergePriceSnapshots } = await import('../../web/lib/live-prices');
  const current = {
    last_price_vnd: 22000,
    reference_vnd: 20000,
    fetched_at: '2026-10-16T03:02:00Z',
  };
  const old = {
    ...current,
    last_price_vnd: 21000,
    fetched_at: '2026-10-16T03:01:00Z',
  };
  expect(mergePriceSnapshots({ ACB: current }, { ACB: old })).toEqual({
    ACB: current,
  });
  const newer = {
    ...current,
    last_price_vnd: 21500,
    fetched_at: '2026-10-16T03:03:00Z',
  };
  expect(mergePriceSnapshots({ ACB: current }, { ACB: newer })).toEqual({
    ACB: newer,
  });
});
