import { expect, it, vi } from 'vitest';
import {
  auditPrompt,
  auditTargets,
  collectStockExport,
} from '../../web/lib/stock-export';
import type { StockDetail } from '../../web/lib/market-client';
import { defaultSettings } from '../../modules/settings/scoring-settings';
import type { FinancialData } from '../../modules/providers/financial-types';
const now = '2026-10-16T15:00:00.000Z';
const detail: StockDetail = {
  stock: { symbol: 'VNM', name: 'Vinamilk', exchange: 'HOSE', source: 'KBS' },
  quote: null,
  bars: [],
  notices: ['Timestamp sàn chưa xác minh'],
  historySource: 'KBS',
  notice: 'Giá chưa xác minh điều chỉnh',
};
const financials: FinancialData = {
  symbol: 'VNM',
  source: 'KBS_VIETCAP',
  fetchedAt: now,
  verification: 'provider_reported',
  businessType: 1,
  supported: true,
  currentShares: null,
  annual: [],
  notices: ['Không đủ dữ liệu'],
};
function readers() {
  const read = vi.fn(async (path: string) =>
    path.includes('financials')
      ? {
          financials,
          backups: [{ source: 'Vietcap', fetched_at: now }],
          notices: ['CFO mẹ thiếu'],
        }
      : {
          symbol: 'VNM',
          articles: [
            {
              title: 'VNM trả cổ tức',
              source_url: 'https://example.test/report',
            },
          ],
        },
  );
  const history = vi.fn(async () => ({
    ...detail,
    bars: Array.from({ length: 20 }, (_, i) => ({
      symbol: 'VNM',
      sessionDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
      openVnd: i + 1,
      highVnd: i + 2,
      lowVnd: i + 1,
      closeVnd: i + 1,
      volumeReported: 100,
      volumeUnit: 'shares' as const,
      source: 'KBS' as const,
      fetchedAt: now,
      priceBasis: 'unverified' as const,
      isFinal: false,
    })),
  }));
  return { read, history };
}
it('exports all public fields, nulls, sources and timestamps without rounding or dropping history; MA has independent answer', async () => {
  const { read, history } = readers();
  const s = await collectStockExport(
    detail,
    defaultSettings,
    new AbortController().signal,
    read,
    history,
    now,
  );
  expect(s.market).toEqual(detail);
  expect(s.financials).toEqual(await read('/v1/financials/VNM'));
  expect(s.history?.bars).toHaveLength(20);
  // MA20 = (1+2+...+20)/20 = 210/20 = 10.5 VND, not 10,500 VND.
  expect(s.technicals.ma20).toEqual([{ time: '2026-09-20', value: 10.5 }]);
  expect(s.technicals.ma50).toEqual([]);
  expect(s.technicals.macd12_26_9).toMatchObject({ ok: false });
  expect(s.exportedAt).toBe(now);
  expect(s.scoringAtExport.quoteUsable).toBe(false);
  expect(s.resources.every((r) => r.status === 'received')).toBe(true);
  expect(JSON.stringify(s)).not.toMatch(
    /NaN|Infinity|access_token|owner_id|watchlists/,
  );
  expect(
    read.mock.calls.every(
      ([path]) =>
        path.startsWith('/v1/financials/') || path.startsWith('/v1/news?'),
    ),
  ).toBe(true);
});
it('partial outages stay explicit; no fabricated financials/technicals and no provider error text leaks', async () => {
  const s = await collectStockExport(
    detail,
    defaultSettings,
    new AbortController().signal,
    async () => {
      throw Error('SECRET-provider-error');
    },
    async () => {
      throw Error('unavailable');
    },
    now,
  );
  expect(s.resources.map((r) => r.status)).toEqual([
    'unavailable',
    'unavailable',
    'unavailable',
  ]);
  expect(s.financials).toBeNull();
  expect(s.history).toBeNull();
  expect(s.news).toBeNull();
  expect(s.technicals.rsi14.ok).toBe(false);
  expect(auditPrompt(s)).not.toContain('SECRET');
  expect(auditPrompt(s)).toContain('không có quyền duyệt web');
  expect(auditPrompt(s)).toContain('BEGIN_STOCK_DATA');
});
it('refuses cross-symbol source contamination and does not use unverified ratios as financials', async () => {
  const { read, history } = readers();
  await expect(
    collectStockExport(
      detail,
      defaultSettings,
      new AbortController().signal,
      async () => ({ financials: { ...financials, symbol: 'FPT' } }),
      history,
      now,
    ),
  ).rejects.toThrow('BCTC sai mã');
  await expect(
    collectStockExport(
      detail,
      defaultSettings,
      new AbortController().signal,
      read,
      async () => ({ ...detail, stock: { ...detail.stock, symbol: 'FPT' } }),
      now,
    ),
  ).rejects.toThrow('Lịch sử sai mã');
});
it('aborted collection does not produce a stale export', async () => {
  const { read, history } = readers();
  const controller = new AbortController();
  controller.abort();
  await expect(
    collectStockExport(
      detail,
      defaultSettings,
      controller.signal,
      read,
      history,
      now,
    ),
  ).rejects.toThrow('Đã hủy');
});
it('opens fixed AI homepages without putting stock data in query strings', () => {
  expect(auditTargets.chatgpt.url).toBe('https://chatgpt.com/');
  expect(auditTargets.claude.url).toBe('https://claude.ai/new');
  for (const target of Object.values(auditTargets))
    expect(new URL(target.url).search).toBe('');
});
