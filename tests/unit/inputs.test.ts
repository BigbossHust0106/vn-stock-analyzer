import { expect, it } from 'vitest';
import {
  closingSeries,
  grahamFromFinancials,
  type FinancialSnapshot,
} from '../../modules/strategies/inputs';
const missing = { ok: false, reason: 'không đủ dữ liệu' };
it('Không nhầm nghìn/đồng hoặc EPS quý/năm', () => {
  const annual = {
    eps: 4,
    bvps: 25,
    epsBasis: 'annual',
    currencyUnit: 'thousand_VND',
  } as const;
  // sqrt(22.5*4000*25000)=47434.1649025 VND; chỉ đổi đơn vị, không annualize.
  expect(grahamFromFinancials(annual)).toMatchObject({
    ok: true,
    value: expect.closeTo(47434.1649025, 6),
  });
  expect(
    grahamFromFinancials({
      ...annual,
      eps: 4000,
      bvps: 25000,
      currencyUnit: 'VND',
      epsBasis: 'ttm',
    }),
  ).toEqual(grahamFromFinancials(annual));
  expect(grahamFromFinancials({ ...annual, epsBasis: 'quarter' })).toEqual(
    missing,
  );
  expect(grahamFromFinancials(null)).toEqual(missing);
  expect(grahamFromFinancials({ ...annual, eps: null })).toEqual(missing);
  expect(grahamFromFinancials({ ...annual, bvps: 0 })).toEqual(missing);
  expect(
    grahamFromFinancials({
      ...annual,
      currencyUnit: 'USD',
    } as unknown as FinancialSnapshot),
  ).toEqual(missing);
});
it('Không trộn giá adjusted/unadjusted hoặc giá chưa rõ basis', () => {
  const points = [
    { closeVnd: 100, priceBasis: 'adjusted' },
    { closeVnd: 110, priceBasis: 'adjusted' },
  ] as const;
  expect(closingSeries(points)).toEqual({ ok: true, value: [100, 110] });
  expect(
    closingSeries([points[0], { closeVnd: 110, priceBasis: 'unadjusted' }]),
  ).toEqual(missing);
  expect(closingSeries([{ closeVnd: 100, priceBasis: 'unverified' }])).toEqual(
    missing,
  );
  expect(
    closingSeries([points[0], { closeVnd: NaN, priceBasis: 'adjusted' }]),
  ).toEqual(missing);
  expect(closingSeries([])).toEqual(missing);
  expect(closingSeries(null)).toEqual(missing);
  expect(closingSeries([null])).toEqual(missing);
  expect(closingSeries([points[0], null])).toEqual(missing);
});
