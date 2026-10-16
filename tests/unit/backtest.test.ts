import { afterEach, expect, it, vi } from 'vitest';
import {
  evaluateCohort,
  priceReturn,
  summarize,
  type Cohort,
} from '../../modules/backtest/returns';
import { apiRateLimit } from '../../worker/src/api/rate-limit';
import { publicReadCache } from '../../worker/src/api/public-cache';
import { backtestResponse } from '../../worker/src/api/backtest';
import {
  defaultRiskSettings,
  validRiskSettings,
} from '../../modules/settings/risk-settings';
afterEach(() => vi.unstubAllGlobals());
it('return calculation: VND and index points remain dimensionless, no annualization', () => {
  // Hand calculation: (33,000 / 30,000 - 1)*100 = 10%; (900/1000-1)*100 = -10%.
  expect(priceReturn(30000, 33000)).toBeCloseTo(10);
  expect(priceReturn(1000, 900)).toBeCloseTo(-10);
  for (const bad of [0, -1, NaN, Infinity, null, undefined, '30000']) {
    expect(priceReturn(bad, 33000)).toBeNull();
    expect(priceReturn(30000, bad)).toBeNull();
  }
  expect(priceReturn(Number.MIN_VALUE, Number.MAX_VALUE)).toBeNull();
});
it('equal-weight portfolio/win rate/excess: +20%, -10%, 0% => 3.333%, 1/3 wins; index +5%', () => {
  // Hand: (20-10+0)/3=10/3; excess=10/3-5=-5/3 percentage points.
  const s = summarize(
    [120, 90, 100].map((exit, i) => ({
      symbol: String(i),
      entry: 100,
      exit,
      benchmarkEntry: 1000,
      benchmarkExit: 1050,
    })),
    3,
  );
  expect(s.returnPct).toBeCloseTo(10 / 3);
  expect(s.winRatePct).toBeCloseTo(100 / 3);
  expect(s.excessPct).toBeCloseTo(-5 / 3);
  expect(s.measured).toBe(3);
});
it('missing/invalid/delisted member and empty publication never become zero or renormalized performance', () => {
  const good = { symbol: 'AAA', entry: 100, exit: 120 };
  expect(
    summarize([good, { symbol: 'BBB', entry: null, exit: null }], 2).returnPct,
  ).toBeNull();
  expect(summarize([good], 2).returnPct).toBeNull();
  expect(summarize([], 0).winRatePct).toBeNull();
  expect(summarize([{ ...good, reason: 'Calendar gap' }], 1).measured).toBe(0);
  expect(summarize([good], 1).benchmarkPct).toBeNull();
  expect(
    summarize([{ ...good, benchmarkEntry: 100, benchmarkExit: 0 }], 1)
      .excessPct,
  ).toBeNull();
  const c = {
    items: [],
    legs: { day: [], month: [], quarter: [] },
  } as unknown as Cohort;
  expect(evaluateCohort(c).results.quarter.complete).toBe(false);
});
it('risk preferences enforce finite input, bounds and method', () => {
  expect(validRiskSettings(defaultRiskSettings)).toBe(true);
  for (const v of [
    null,
    {},
    { ...defaultRiskSettings, maxLoss: 0 },
    { ...defaultRiskSettings, atrMultiple: 6 },
    { ...defaultRiskSettings, trailingPercent: NaN },
    { ...defaultRiskSettings, stopMethod: 'unknown' },
  ])
    expect(validRiskSettings(v)).toBe(false);
});
it('Worker rate limiter denies before database, returns no-store and retry-after; fails closed on binding errors', async () => {
  const req = new Request('https://app.test/v1/backtest', {
    headers: { 'CF-Connecting-IP': '192.0.2.3' },
  });
  const limit = vi.fn(async () => ({ success: false }));
  const response = await apiRateLimit(req, { API_RATE_LIMIT: { limit } });
  expect(response?.status).toBe(429);
  expect(response?.headers.get('Retry-After')).toBe('60');
  expect(response?.headers.get('Cache-Control')).toBe('no-store');
  expect(limit).toHaveBeenCalledWith({ key: 'api:192.0.2.3' });
  expect(
    (
      await apiRateLimit(req, {
        API_RATE_LIMIT: {
          limit: async () => {
            throw Error('private provider detail');
          },
        },
      })
    )?.status,
  ).toBe(503);
  expect(
    (await apiRateLimit(req, { ANALYSIS_RATE_LIMIT: { limit } }))?.status,
  ).toBe(429);
  expect(
    await apiRateLimit(
      new Request('https://app.test/v1/internal/system-sync'),
      { API_RATE_LIMIT: { limit } },
    ),
  ).toBeNull();
  expect(
    (
      await apiRateLimit(
        new Request('https://app.test/v1/backtest?q=' + 'a'.repeat(2100)),
        {},
      )
    )?.status,
  ).toBe(414);
});
it('public cache hits reuse one database response; no personal, cookie, bearer, error or Set-Cookie cache', async () => {
  const values = new Map<string, Response>(),
    writes: Promise<unknown>[] = [];
  const put = vi.fn(async (k: Request, v: Response) => {
    values.set(k.url, v.clone());
  });
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (k: Request) => values.get(k.url)?.clone(),
      put,
    }),
  });
  const context = {
    waitUntil: (p: Promise<unknown>) => {
      writes.push(p);
    },
  };
  const load = vi.fn(async () =>
    Response.json(
      { public: true },
      { headers: { 'Cache-Control': 'public, max-age=60' } },
    ),
  );
  const req = new Request('https://app.test/v1/backtest?horizon=day');
  expect(
    (await publicReadCache(req, context, load)).headers.get('X-Data-Cache'),
  ).toBe('MISS');
  await Promise.all(writes);
  expect(
    (await publicReadCache(req, context, load)).headers.get('X-Data-Cache'),
  ).toBe('HIT');
  expect(load).toHaveBeenCalledOnce();
  for (const r of [
    new Request('https://app.test/v1/notifications'),
    new Request(req, { headers: { Authorization: 'Bearer fixture' } }),
    new Request(req, { headers: { Cookie: 'session=fixture' } }),
    new Request(req, { method: 'POST' }),
  ])
    await publicReadCache(r, context, load);
  expect(put).toHaveBeenCalledOnce();
  await publicReadCache(
    new Request('https://app.test/v1/backtest?horizon=month'),
    context,
    async () => Response.json({}, { status: 502 }),
  );
  await publicReadCache(
    new Request('https://app.test/v1/backtest?horizon=quarter'),
    context,
    async () =>
      new Response('private', {
        headers: {
          'Cache-Control': 'public, max-age=60',
          'Set-Cookie': 'private',
        },
      }),
  );
  expect(put).toHaveBeenCalledOnce();
});
it('validates backtest cursors and rejects duplicate filters before querying', async () => {
  for (const query of [
    'horizon=evil',
    'mode=prices&start=2025-02-30',
    'mode=prices&start=2025-01-01&symbol=x',
    'horizon=day&horizon=month',
    'before=bad&id=123',
    'before=2025-01-01',
    'q=unknown',
  ])
    expect(
      (
        await backtestResponse(
          new Request('https://app.test/v1/backtest?' + query),
          {},
        )
      )?.status,
    ).toBe(400);
  expect(
    (await backtestResponse(new Request('https://app.test/v1/backtest'), {}))
      ?.status,
  ).toBe(503);
  expect(
    await backtestResponse(new Request('https://app.test/v1/nope'), {}),
  ).toBeNull();
});
