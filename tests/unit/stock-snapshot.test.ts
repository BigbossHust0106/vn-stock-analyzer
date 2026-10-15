import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';
import { displayPrice } from '../../modules/market/display-price';
import { parseVpsPayload } from '../../modules/providers/vps-provider';
import fixture from '../../fixtures/vps-getliststockdata-sample.json';
const timestamp = Date.parse('2026-10-15T01:00:00Z'); // 08:00 Việt Nam, before the open.
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('Before open: quote lastPrice=0/null displays prior session close20450, never reference20150', () => {
  const q = parseVpsPayload([fixture[0]], '2026-10-15T01:00:00Z')[0]!;
  const close = { sessionDate: '2026-10-14', closeVnd: 20450, source: 'VPS' };
  // Hand answer: daily close20.45 thousand VND ×1000 =20450 VND; reference20.15 is different.
  expect(displayPrice({ ...q, lastPriceVnd: null }, close, timestamp)).toEqual({
    valueVnd: 20450,
    kind: 'close',
    sessionDate: '2026-10-14',
    source: 'VPS',
  });
  expect(
    displayPrice({ ...q, lastPriceVnd: 21000 }, close, timestamp).valueVnd,
  ).toBe(20450);
  expect(displayPrice(q, close, Date.parse('2026-10-15T02:30:00Z')).kind).toBe(
    'quote',
  );
  expect(
    displayPrice({ ...q, fetchedAt: 'invalid' }, close, timestamp).kind,
  ).toBe('close');
  expect(
    displayPrice({ ...q, fetchedAt: '2026-10-14T08:00:00Z' }, close, timestamp)
      .kind,
  ).toBe('close');
  expect(
    displayPrice(null, { ...close, sessionDate: '2026-10-15' }, timestamp)
      .valueVnd,
  ).toBeNull();
  expect(
    displayPrice(null, { ...close, closeVnd: NaN }, timestamp).valueVnd,
  ).toBeNull();
});
it('Summary never waits for history/profile or a stalled background quote; returns close from one stored bar', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://bgapidatafeed.vps.com.vn/'))
        return new Promise<Response>(() => {});
      if (url.includes('/stocks?'))
        return Response.json({
          id: 'id',
          symbol: 'ACB',
          name: 'ACB',
          exchange: 'HOSE',
          source: 'KBS',
        });
      if (url.includes('/prices_current?'))
        return Response.json({
          reference_vnd: 20150,
          ceiling_vnd: 21550,
          floor_vnd: 18750,
          last_price_vnd: null,
          bid3_price_vnd: null,
          total_volume_shares: 0,
          last_volume_raw: 0,
          lot_raw: 0,
          fetched_at: '2026-10-14T01:00:00Z',
        });
      if (url.includes('/stock_closing_snapshots?'))
        return Response.json({
          session_date: '2026-10-14',
          price_vnd: 20000,
          fetched_at: '2026-10-14T09:00:00Z',
        });
      if (url.includes('/prices_history?')) {
        expect(url).toContain('limit=1');
        expect(url).toContain('session_date=lt.2026-10-15');
        return Response.json([
          {
            session_date: '2026-10-14',
            open_vnd: 20200,
            high_vnd: 20550,
            low_vnd: 20150,
            close_vnd: 20450,
            volume_reported: 7969100,
            fetched_at: new Date(timestamp).toISOString(),
          },
        ]);
      }
      throw new Error('Unexpected request: ' + url);
    }),
  );
  const jobs: Promise<unknown>[] = [];
  const response = await worker.fetch(
    new Request('https://app.test/v1/stocks/ACB?view=summary'),
    env,
    {
      waitUntil: (p) => {
        jobs.push(p);
      },
    },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    bars: unknown[];
    quote: { lastPriceVnd: null };
    displayPrice: { valueVnd: number; kind: string };
  };
  expect(body.bars).toEqual([]);
  expect(body.quote.lastPriceVnd).toBeNull();
  expect(body.displayPrice).toMatchObject({ valueVnd: 20450, kind: 'close' });
  expect(jobs).toHaveLength(1); // deliberately unresolved; response must already have completed.
  expect(
    calls.some((u) => u.includes('histdatafeed') || u.includes('tradingview')),
  ).toBe(false);
});
it('History with stored bars never fetches quote/profile and keeps source finality unverified', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/stocks?'))
        return Response.json({
          id: 'id',
          symbol: 'ACB',
          name: 'ACB',
          exchange: 'HOSE',
          source: 'KBS',
        });
      if (url.includes('/prices_current?')) return Response.json(null);
      if (url.includes('/stock_closing_snapshots?')) return Response.json(null);
      if (url.includes('/prices_history?'))
        return Response.json([
          {
            session_date: '2026-10-14',
            open_vnd: 20200,
            high_vnd: 20550,
            low_vnd: 20150,
            close_vnd: 20450,
            volume_reported: 7969100,
            fetched_at: new Date(timestamp).toISOString(),
          },
        ]);
      throw new Error('Unexpected upstream request');
    }),
  );
  const r = await worker.fetch(
    new Request('https://app.test/v1/stocks/ACB?view=history'),
    env,
  );
  expect(r.status).toBe(200);
  expect(
    ((await r.json()) as { bars: { isFinal: boolean }[] }).bars[0]!.isFinal,
  ).toBe(false);
  expect(calls.every((u) => u.startsWith(env.SUPABASE_URL))).toBe(true);
});
