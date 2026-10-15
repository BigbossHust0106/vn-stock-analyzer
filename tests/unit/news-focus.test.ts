import { expect, it } from 'vitest';
import { selectStockNews } from '../../modules/news/relevance';
const direct = {
  title: 'VNM công bố doanh thu',
  symbols: ['VNM'],
  sectors: ['Sữa'],
  published_at: '2026-10-10T00:00:00Z',
};
const other = {
  title: 'FPT ký hợp đồng',
  symbols: ['FPT'],
  sectors: ['Công nghệ'],
  published_at: '2026-10-15T00:00:00Z',
};
const generic = {
  title: 'Lãi suất điều hành thay đổi',
  symbols: [],
  sectors: [],
  published_at: '2026-10-14T00:00:00Z',
};
it('default stock feed contains only explicit ticker evidence, even if unrelated news is newer', () => {
  expect(selectStockNews([other, generic, direct], 'VNM', 'Sữa')).toEqual([
    direct,
  ]);
  expect(selectStockNews([other, generic], 'VNM', null)).toEqual([]);
});
it('context is opt-in, related sectors only; direct stock article stays first', () => {
  const sector = {
    ...other,
    title: 'Doanh nghiệp sữa cập nhật ngành',
    sectors: ['Sữa'],
  };
  expect(
    selectStockNews([other, generic, sector, direct], 'VNM', 'Sữa', true),
  ).toEqual([direct, sector, generic]);
  expect(
    selectStockNews(
      [{ ...direct, title: 'VNM nhận iPhone ưu đãi' }],
      'VNM',
      'Sữa',
      true,
    ),
  ).toEqual([]);
});
import worker from '../../worker/src/index';
import { vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('API default does not query generic articles; scope=context opts in, with strict ticker priority', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const u = new URL(String(input));
      calls.push(u.href);
      if (u.pathname.endsWith('/stocks'))
        return Response.json({ id: 'stock-vnm', symbol: 'VNM', sector: 'Sữa' });
      if (u.pathname.endsWith('/news_feed_articles'))
        return Response.json(
          u.searchParams.has('symbols')
            ? [{ ...direct, id: 'direct' }]
            : [
                { ...generic, id: 'generic' },
                { ...other, id: 'other' },
              ],
        );
      if (u.pathname.endsWith('/news_sources')) return Response.json([]);
      return Response.json(null);
    }),
  );
  const env = {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'local-test-public',
  };
  const r = await worker.fetch(
    new Request('https://app.test/v1/news?symbol=VNM'),
    env,
  );
  expect(r.status).toBe(200);
  expect(
    ((await r.json()) as { articles: { id: string }[] }).articles.map(
      (a) => a.id,
    ),
  ).toEqual(['direct']);
  expect(calls.filter((u) => u.includes('/news_feed_articles?'))).toHaveLength(
    1,
  );
  calls.length = 0;
  const context = await worker.fetch(
    new Request('https://app.test/v1/news?symbol=VNM&scope=context'),
    env,
  );
  expect(context.status).toBe(200);
  expect(
    ((await context.json()) as { articles: { id: string }[] }).articles.map(
      (a) => a.id,
    ),
  ).toEqual(['direct', 'generic']);
  expect(calls.filter((u) => u.includes('/news_feed_articles?'))).toHaveLength(
    2,
  );
  expect(
    (
      await worker.fetch(
        new Request('https://app.test/v1/news?symbol=VNM&scope=unknown'),
        env,
      )
    ).status,
  ).toBe(400);
});
