import { afterEach, expect, it, vi } from 'vitest';
import { rankingsResponse } from '../../worker/src/api/rankings';
import { fetchRankings } from '../../web/lib/rankings';
import { rankStock } from '../../modules/scoring/rankings';
import { publicReadCache } from '../../worker/src/api/public-cache';
afterEach(() => vi.unstubAllGlobals());
const rows = Array.from({ length: 23 }, (_, i) => ({
  stock_id: 'id-' + i,
  symbol: 'S' + String(i).padStart(2, '0'),
  score: i,
  explanation: {
    ...rankStock({
      stockId: 'test',
      financials: null,
      priceVnd: null,
      referenceVnd: null,
      quoteFetchedAt: null,
      bars: [],
      events: [],
      asOf: '2026-10-16T03:00:00Z',
    })[0]!.explanation,
    coverage: 1,
    rankingEligibility: {
      policy: 'complete-v1',
      eligible: true,
      quoteVerified: true,
      financialCoverage: 1,
      blockers: [],
    },
  },
}));
it.each(['day', 'month', 'quarter'])(
  'API %s returns exactly 10 unique qualified rows out of 23, with independent descending expected order',
  async (horizon) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) =>
        Response.json(
          String(input).includes('ranking_news_inputs')
            ? [...rows, rows[22]]
            : [],
        ),
      ),
    );
    const r = (await rankingsResponse(
      new Request(
        'https://app.test/v1/rankings?horizon=' + horizon + '&newsWeight=0',
      ),
      {
        SUPABASE_URL: 'https://db.example.test',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      },
    ))!;
    const data = (
      (await r.json()) as { data: { symbol: string; position: number }[] }
    ).data;
    // Scores0..22 => top ten22..13, not the first ten and no duplicated S22.
    expect(data.map((row: { symbol: string }) => row.symbol)).toEqual([
      'S22',
      'S21',
      'S20',
      'S19',
      'S18',
      'S17',
      'S16',
      'S15',
      'S14',
      'S13',
    ]);
    expect(data.map((row: { position: number }) => row.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=60');
  },
);
it('client caps even a legacy 23-row response, deduplicates symbols, never merges excluded into Top10', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        data: [rows[22], ...[...rows].reverse()],
        excluded: rows,
        sectors: [],
        run: null,
      }),
    ),
  );
  const r = await fetchRankings(
    'day',
    '',
    '',
    '',
    new AbortController().signal,
  );
  expect(r.data.map((row) => row.symbol)).toEqual([
    'S22',
    'S21',
    'S20',
    'S19',
    'S18',
    'S17',
    'S16',
    'S15',
    'S14',
    'S13',
  ]);
  expect(r.excluded).toHaveLength(23);
});
it('rankings/summary use the new public cache namespace; live quote requests remain uncached', async () => {
  const open = vi.fn();
  vi.stubGlobal('caches', { open });
  const load = vi.fn(async () => Response.json({ data: [] }));
  for (const p of [
    '/v1/rankings',
    '/v1/quotes?symbols=ACB',
    '/v1/stocks/ACB?view=summary',
  ])
    await publicReadCache(
      new Request('https://app.test' + p),
      { waitUntil: () => {} },
      load,
    );
  expect(load).toHaveBeenCalledTimes(3);
  expect(
    open.mock.calls.every(([name]) => name === 'vn-stock-public-io-v1'),
  ).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
});
