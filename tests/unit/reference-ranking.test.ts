import { afterEach, expect, it, vi } from 'vitest';
import { rankingsResponse } from '../../worker/src/api/rankings';
import { fetchRankings } from '../../web/lib/rankings';
import { rankStock } from '../../modules/scoring/rankings';
import {
  referenceMinCoverage,
  referencePolicy,
  referenceRows,
} from '../../modules/scoring/reference';
import {
  refreshStaleFinancials,
  staleFinancialSymbols,
} from '../../worker/src/financial-sync';
afterEach(() => vi.unstubAllGlobals());
const base = rankStock({
  stockId: 'test',
  financials: null,
  priceVnd: null,
  referenceVnd: null,
  quoteFetchedAt: null,
  bars: [],
  events: [],
  asOf: '2026-10-16T03:00:00Z',
})[2]!.explanation;
function row(
  i: number,
  score: number | null,
  coverage: number,
  eligible = true,
  complete = false,
) {
  return {
    stock_id: 'id-' + i,
    symbol: 'S' + String(i).padStart(2, '0'),
    score,
    explanation: {
      ...base,
      eligible,
      coverage,
      rankingEligibility: {
        policy: 'complete-v1',
        eligible: complete,
        quoteVerified: complete,
        financialCoverage: complete ? 1 : 0.9,
        blockers: complete ? [] : ['Thiếu đầu vào cho đủ 100% trọng số.'],
      },
    },
  };
}
it('referenceRows: chỉ mã qua lọc BCTC, có điểm, bao phủ ≥30%; không trùng Top 10 chuẩn', () => {
  expect(referencePolicy).toBe('reference-v1');
  expect(referenceMinCoverage).toBe(0.3);
  const rows = [
    row(1, 40, 0.63),
    row(2, 55, 0.63),
    row(3, 70, 0.63, false), // chưa qua lọc BCTC => loại
    row(4, null, 0.63), // không có điểm => loại
    row(5, 25, 0.29), // bao phủ 29% < 30% => loại
    row(6, 55, 0.7), // cùng điểm 55, bao phủ cao hơn => đứng trước S02
    row(7, 60, 0.63), // đã ở Top 10 chuẩn => loại
    row(1, 99, 0.63), // bản trùng mã S01 sau khi sắp xếp vẫn chỉ giữ một dòng
  ];
  // Tính tay: còn S01(99), S06(55, 0,7), S02(55, 0,63); bản S01(40) bị bỏ vì trùng.
  const out = referenceRows(rows, new Set(['id-7']));
  expect(out.map((r) => [r.symbol, r.score, r.position, r.tier])).toEqual([
    ['S01', 99, 1, 'reference'],
    ['S06', 55, 2, 'reference'],
    ['S02', 55, 3, 'reference'],
  ]);
  expect(referenceRows(rows, new Set(), 2)).toHaveLength(2);
  expect(referenceRows(rows, new Set(), -1)).toEqual([]);
});
function stubRankings(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      Response.json(String(input).includes('ranking_news_inputs') ? rows : []),
    ),
  );
}
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};
it('API: Top 10 chuẩn rỗng thì trả Bảng tham khảo tách riêng, tối đa 10 mã', async () => {
  // 12 mã điểm 0..11 đều thiếu đầu vào => Top 10 chuẩn rỗng; tham khảo = 11..2.
  stubRankings(Array.from({ length: 12 }, (_, i) => row(i, i, 0.63)));
  const r = (await rankingsResponse(
    new Request('https://app.test/v1/rankings?horizon=quarter&newsWeight=0'),
    env,
  ))!;
  const body = (await r.json()) as {
    data: unknown[];
    reference: { symbol: string; position: number }[];
    referencePolicy: string;
  };
  expect(body.data).toEqual([]);
  expect(body.referencePolicy).toBe('reference-v1');
  expect(body.reference.map((x) => x.symbol)).toEqual([
    'S11',
    'S10',
    'S09',
    'S08',
    'S07',
    'S06',
    'S05',
    'S04',
    'S03',
    'S02',
  ]);
  expect(body.reference.map((x) => x.position)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
});
it('API: đủ 10 mã chuẩn thì không trả Bảng tham khảo', async () => {
  stubRankings([
    ...Array.from({ length: 10 }, (_, i) => row(i, 50 + i, 1, true, true)),
    row(20, 99, 0.63),
  ]);
  const r = (await rankingsResponse(
    new Request('https://app.test/v1/rankings?horizon=quarter&newsWeight=0'),
    env,
  ))!;
  const body = (await r.json()) as { data: unknown[]; reference: unknown[] };
  expect(body.data).toHaveLength(10);
  expect(body.reference).toEqual([]);
});
it('Client: không để mã tham khảo trùng Top 10 chuẩn và bỏ tham khảo khi đã đủ 10', async () => {
  const official = row(1, 80, 1, true, true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        data: [official],
        reference: [row(1, 70, 0.63), row(2, 60, 0.63), row(2, 50, 0.63)],
        run: null,
        sectors: [],
      }),
    ),
  );
  const r = await fetchRankings(
    'quarter',
    '',
    '',
    '',
    new AbortController().signal,
  );
  expect(r.data.map((x) => x.symbol)).toEqual(['S01']);
  expect(r.reference?.map((x) => [x.symbol, x.position])).toEqual([['S02', 1]]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        data: Array.from({ length: 10 }, (_, i) => row(i, 80, 1, true, true)),
        reference: [row(30, 70, 0.63)],
        run: null,
        sectors: [],
      }),
    ),
  );
  const full = await fetchRankings(
    'quarter',
    '',
    '',
    '',
    new AbortController().signal,
  );
  expect(full.reference).toEqual([]);
});
it('Chọn mã BCTC cần làm mới: chưa có snapshot trước, rồi cũ nhất; xoay vòng theo lượt 5 phút', () => {
  const stocks = [
    { id: 'a', symbol: 'AAA' },
    { id: 'b', symbol: 'BBB' },
    { id: 'c', symbol: 'CCC' },
    { id: 'd', symbol: 'DDD' },
  ];
  const now = Date.parse('2026-10-16T00:00:00Z'); // chia hết 300000 ms
  const fetched = new Map([
    ['a', '2026-10-15T23:00:00Z'], // 1 giờ < 25 giờ => còn mới
    ['b', '2026-10-14T00:00:00Z'], // 48 giờ
    ['c', '2026-10-14T22:00:00Z'], // 26 giờ
    ['x', 'không phải ngày'],
  ]);
  // Thứ tự cũ nhất: DDD (chưa có) > BBB (48h) > CCC (26h); AAA mới nên bỏ.
  // now/300000 = 5.920.560.000/300 => lượt chia hết cho 3 => turn = 0.
  expect(Math.floor(now / 300000) % 3).toBe(0);
  expect(
    staleFinancialSymbols(stocks, fetched, now).map((s) => s.symbol),
  ).toEqual(['DDD', 'BBB', 'CCC']);
  // Lượt kế tiếp (+5 phút) => turn = 1 => BBB lên đầu, mã lỗi không chặn mã khác.
  expect(
    staleFinancialSymbols(stocks, fetched, now + 300000).map((s) => s.symbol),
  ).toEqual(['BBB', 'CCC', 'DDD']);
  expect(
    staleFinancialSymbols(stocks.slice(0, 1), fetched, now).map(
      (s) => s.symbol,
    ),
  ).toEqual([]);
});
it('Làm mới BCTC: nguồn lỗi giữ snapshot cũ, không ghi BCTC, trạng thái degraded', async () => {
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) writes.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes('/rest/v1/stocks'))
        return Response.json([{ id: 'id-vnm', symbol: 'VNM' }]);
      if (url.includes('/rest/v1/financial_snapshots'))
        return Response.json([]);
      if (url.includes('/rest/v1/system_status'))
        return new Response(null, { status: 201 });
      // KBS trả sai cấu trúc (thiếu Head/Content) => adapter từ chối, không đoán.
      if (url.includes('kbbuddywts.kbsec.com.vn')) return Response.json({});
      return new Response('unavailable', { status: 503 });
    }),
  );
  const result = await refreshStaleFinancials(
    {
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
      SYNC_SYMBOLS: 'VNM',
    },
    Date.parse('2026-10-16T00:00:00Z'),
  );
  expect(result).toEqual({ refreshed: [], failed: ['VNM'], pending: 1 });
  expect(writes.some((w) => w.url.includes('persist_financial_score'))).toBe(
    false,
  );
  expect(
    writes.find((w) => w.url.includes('system_status'))?.body,
  ).toMatchObject({ component: 'fundamentals', state: 'degraded' });
  expect(
    (writes.find((w) => w.url.includes('system_status'))?.body as object) ?? {},
  ).not.toHaveProperty('last_success_at');
});
it('Làm mới BCTC: mọi snapshot còn mới thì chỉ thử kho dự phòng, lỗi không làm hỏng cron', async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/rest/v1/stocks'))
        return Response.json([{ id: 'id-vnm', symbol: 'VNM' }]);
      if (url.includes('/rest/v1/financial_snapshots'))
        return Response.json([
          { stock_id: 'id-vnm', fetched_at: '2026-10-15T23:00:00Z' },
        ]);
      if (url.includes('/rest/v1/financial_report_backups'))
        return url.includes('select=fetched_at')
          ? Response.json(null)
          : Response.json([]);
      return new Response('unavailable', { status: 503 });
    }),
  );
  const result = await refreshStaleFinancials(
    {
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
      SYNC_SYMBOLS: 'VNM',
    },
    Date.parse('2026-10-16T00:00:00Z'),
  );
  expect(result).toEqual({ refreshed: [], failed: [], pending: 0 });
  expect(urls.some((u) => u.includes('kbbuddywts.kbsec.com.vn'))).toBe(false);
  expect(urls.some((u) => u.includes('iq.vietcap.com.vn'))).toBe(true);
  expect(urls.some((u) => u.includes('system_status'))).toBe(false);
});
