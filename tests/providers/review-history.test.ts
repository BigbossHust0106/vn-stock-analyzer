import { expect, it } from 'vitest';
import { KbsProvider } from '../../modules/providers/kbs-provider';
import { defaultHttpOptions } from '../../modules/providers/http';
it('Review3/4: nhiều phiên KBS đảo thứ tự trả tăng dần, không tự xác nhận chốt', async () => {
  // Chuỗi raw 13→9→12/10, close11/9/10, volume30/10/20; sau sort9→12→13.
  const p = new KbsProvider(
    async () =>
      Response.json({
        symbol: 'TST',
        data_day: [
          { t: '2026-10-13 07:00', o: 10, h: 12, l: 9, c: 11, v: 30 },
          { t: '2026-10-09 07:00', o: 9, h: 10, l: 8, c: 9, v: 10 },
          { t: '2026-10-12 07:00', o: 9, h: 11, l: 8, c: 10, v: 20 },
        ],
      }),
    { ...defaultHttpOptions, minIntervalMs: 0, retries: 0 },
  );
  const rows = await p.fetchHistory('TST', '2026-10-09', '2026-10-13');
  expect(rows.map((r) => r.sessionDate)).toEqual([
    '2026-10-09',
    '2026-10-12',
    '2026-10-13',
  ]);
  expect(rows.map((r) => r.closeVnd)).toEqual([9, 10, 11]);
  expect(rows.map((r) => r.volumeReported)).toEqual([10, 20, 30]);
  expect(
    rows.every((r) => r.isFinal === false && r.finality === 'unverified'),
  ).toBe(true);
});
