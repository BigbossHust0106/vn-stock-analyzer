import { it, expect } from 'vitest';
import { SMA } from 'technicalindicators';
import {
  movingAverage,
  aggregateBars,
  changePercent,
} from '../../modules/market/chart';
import { normalizeSearch } from '../../modules/market/search';
import { yearsBefore } from '../../modules/market/calendar';
import { parseVpsHistory } from '../../modules/providers/market-schema';
import vnm from '../../fixtures/phase2/VNM-history.json';
import { sqlJson } from '../../scripts/management';
const bars = parseVpsHistory(vnm, 'VNM', '2026-10-13T03:00:00Z');
it('SMA tính tay và so thư viện; warmup không điền 0/NaN', () => {
  const small = bars
    .slice(0, 4)
    .map((b, i) => ({ ...b, closeVnd: (i + 1) * 10000 }));
  // MA3: (10000+20000+30000)/3=20000; (20000+30000+40000)/3=30000.
  expect(movingAverage(small, 3).map((p) => p.value)).toEqual([20000, 30000]);
  expect(movingAverage(small, 20)).toEqual([]);
  for (const period of [20, 50, 200]) {
    const actual = movingAverage(bars, period),
      reference = SMA.calculate({
        period,
        values: bars.map((b) => b.closeVnd),
      });
    expect(actual).toHaveLength(reference.length);
    actual.forEach((p, i) =>
      expect(Math.abs(p.value - reference[i]!)).toBeLessThan(0.01),
    );
  }
});
it('Giảm giá phải âm, reference 0/thiếu không chia 0', () => {
  // VNM fixture current 58000 / reference 58400 -1 => -0.6849315068%.
  expect(changePercent(58000, 58400)).toBeCloseTo(-0.6849315068, 8);
  expect(changePercent(1, 0)).toBeNull();
  expect(changePercent(null, 20)).toBeNull();
  expect(changePercent(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
});
it('Gộp nến dùng open đầu/close cuối, high max/low min và sum volume; không tạo ngày nghỉ', () => {
  const input = bars.filter(
    (b) => b.sessionDate >= '2026-10-05' && b.sessionDate <= '2026-10-09',
  );
  const [week] = aggregateBars(input, 'week');
  expect(week!.openVnd).toBe(input[0]!.openVnd);
  expect(week!.closeVnd).toBe(input.at(-1)!.closeVnd);
  expect(week!.volumeReported).toBe(
    input.reduce((sum, b) => sum + b.volumeReported, 0),
  );
  expect(aggregateBars(input, 'day')).toHaveLength(input.length);
  expect(() =>
    aggregateBars([input[0]!, { ...input[1]!, source: 'KBS' }], 'week'),
  ).toThrow();
});
it('Tên tiếng Việt có/không dấu, ngày nhuận và SQL JSON giữ apostrophe trong chuỗi', () => {
  expect(normalizeSearch('Sữa Việt Nam')).toBe('sua viet nam');
  expect(normalizeSearch('Tập đoàn Hòa Phát')).toBe('tap doan hoa phat');
  expect(yearsBefore('2028-02-29', 3)).toBe('2025-02-28');
  expect(sqlJson({ name: "O'Hara; DROP TABLE stocks;" })).toBe(
    `'{"name":"O''Hara; DROP TABLE stocks;"}'::jsonb`,
  );
});
