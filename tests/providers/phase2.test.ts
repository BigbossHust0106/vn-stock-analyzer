import { describe, it, expect, vi } from 'vitest';
import vnm from '../../fixtures/phase2/VNM-history.json';
import fpt from '../../fixtures/phase2/FPT-history.json';
import hpg from '../../fixtures/phase2/HPG-history.json';
import catalog from '../../fixtures/phase2/kbs-catalog.json';
import profile from '../../fixtures/phase2/FPT-symbol.json';
import {
  parseVpsHistory,
  parseVpsProfile,
  parseKbsStocks,
  historyRange,
} from '../../modules/providers/market-schema';
import { VpsProvider } from '../../modules/providers/vps-provider';
import { KbsProvider } from '../../modules/providers/kbs-provider';
import { providers } from '../../modules/providers/registry';
const fetchedAt = '2026-10-13T03:00:00Z';
describe('Phần 2: payload VPS/KBS gọi thật, không sửa đáp án theo parser', () => {
  it.each([
    ['VNM', vnm, 58400, 1213800],
    ['FPT', fpt, 57100, 5930000],
    ['HPG', hpg, 20700, 31127600],
  ] as const)(
    '%s đối soát phiên 12/10/2026 với KBS',
    (symbol, data, close, volume) => {
      const bars = parseVpsHistory(data, symbol, fetchedAt);
      expect(bars).toHaveLength(256);
      const day = bars.find((b) => b.sessionDate === '2026-10-12')!;
      // VPS nghìn VND ×1000; KBS VND. v history đã là cổ phiếu, không nhân 10.
      expect(day.closeVnd).toBe(close);
      expect(day.volumeReported).toBe(volume);
      expect(day.priceBasis).toBe('unverified');
      // Ngày đã qua không xác nhận dữ liệu đã chốt tại nguồn.
      expect(day.isFinal).toBe(false);
      expect(day.finality).toBe('unverified');
      expect(bars.at(-1)!.isFinal).toBe(false);
    },
  );
  it('Metadata VPS và danh mục KBS tách sàn/loại tài sản, không dùng mc', () => {
    expect(parseVpsProfile(profile, 'FPT', fetchedAt)).toMatchObject({
      name: 'Công ty Cổ phần FPT',
      exchange: 'HOSE',
      source: 'VPS',
    });
    const stocks = parseKbsStocks(
      [
        ...catalog,
        {
          symbol: 'FAKE',
          type: 'index',
          exchange: 'HOSE',
          name: 'Not a stock',
        },
      ],
      fetchedAt,
    );
    expect(stocks).toHaveLength(6);
    expect(stocks.find((s) => s.symbol === 'SHS')!.exchange).toBe('HNX');
    expect(stocks.find((s) => s.symbol === 'QNS')!.exchange).toBe('UPCOM');
  });
  it('Từ chối thiếu mảng, lệch chiều dài, sai mã, OHLC sai, duplicate, NaN và volume phân số', () => {
    for (const bad of [
      { ...vnm, o: [] },
      { ...vnm, symbol: 'HPG' },
      {
        ...vnm,
        t: [1, 1],
        o: [1, 1],
        h: [2, 2],
        l: [1, 1],
        c: [1, 1],
        v: [1, 1],
      },
      {
        symbol: 'VNM',
        s: 'ok',
        t: [1791763200],
        o: [2],
        h: [1],
        l: [1],
        c: [2],
        v: [1],
      },
      {
        symbol: 'VNM',
        s: 'ok',
        t: [1791763200],
        o: [NaN],
        h: [2],
        l: [1],
        c: [1],
        v: [1],
      },
      {
        symbol: 'VNM',
        s: 'ok',
        t: [1791763200],
        o: [1],
        h: [2],
        l: [1],
        c: [1],
        v: [1.5],
      },
    ])
      expect(() => parseVpsHistory(bad, 'VNM', fetchedAt)).toThrow();
    expect(() => historyRange('2026-02-30', '2026-10-13')).toThrow();
    expect(() => historyRange('2026-10-13', '2026-10-12')).toThrow();
  });
  it('Provider cấu hình không fallback ngầm; history có cache clone và query đúng', async () => {
    expect(() => providers({ HISTORY_PROVIDER: 'invented' })).toThrow();
    expect(providers({ HISTORY_PROVIDER: 'kbs' }).history).toBeInstanceOf(
      KbsProvider,
    );
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(fpt));
    const provider = new VpsProvider(transport, {
      ttlMs: 1000,
      minIntervalMs: 0,
      retries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
    });
    const a = await provider.fetchHistory('FPT', '2025-10-01', '2026-10-13');
    a[0]!.closeVnd = 1;
    const b = await provider.fetchHistory('FPT', '2025-10-01', '2026-10-13');
    expect(b[0]!.closeVnd).not.toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
    const url = new URL(String(transport.mock.calls[0]![0]));
    expect(url.searchParams.get('resolution')).toBe('D');
    expect(url.searchParams.get('symbol')).toBe('FPT');
  });
});
