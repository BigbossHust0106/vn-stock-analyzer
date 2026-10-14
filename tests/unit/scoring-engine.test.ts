import { expect, it } from 'vitest';
import { graham } from '../../modules/strategies/graham';
import { buffett, ownerEarningsDcf } from '../../modules/strategies/buffett';
import { scoreStock, conclusion } from '../../modules/scoring/engine';
import {
  defaultSettings,
  validateSettings,
} from '../../modules/settings/scoring-settings';
import {
  availableAnnual,
  consecutiveSeries,
  ratio,
} from '../../modules/strategies/strategy';
import type {
  AnnualFinancials,
  FinancialData,
} from '../../modules/providers/financial-types';
const now = '2026-10-13T09:00:00Z';
const settings = {
  ...defaultSettings,
  growthRate: 0.1,
  discountRate: 0.1,
  terminalGrowth: 0,
  projectionYears: 2,
};
function year(year: number, i: number): AnnualFinancials {
  return {
    year,
    periodEnd: `${year}-12-31`,
    publishedAt: `${year + 1}-03-01T00:00:00+07:00`,
    audited: true,
    consolidated: true,
    revenueVnd: 100 + i * 10,
    netProfitVnd: 20 + i * 2,
    parentProfitVnd: 18 + i * 2,
    epsAnnualVnd: 4,
    bvpsVnd: 25,
    roe: 0.2 + i * 0.01,
    roa: 0.1,
    roic: 0.2,
    grossMargin: 0.3 + i * 0.01,
    netMargin: 0.15 + i * 0.01,
    debtToEquity: 0.1,
    currentAssetsVnd: 300,
    currentLiabilitiesVnd: 100,
    longTermLiabilitiesVnd: 20,
    equityVnd: 250,
    minorityEquityVnd: 0,
    operatingCashFlowVnd: 82 + i * 10,
    capexVnd: 2,
    freeCashFlowVnd: 80 + i * 10,
    dividendsPaidVnd: 2,
    sharesOutstanding: 10,
  };
}
function fixture(): FinancialData {
  return {
    symbol: 'TST',
    source: 'KBS_VIETCAP',
    verification: 'provider_reported',
    fetchedAt: now,
    businessType: 1,
    supported: true,
    currentShares: 10,
    annual: [year(2023, 0), year(2024, 1), year(2025, 2)],
    notices: [],
  };
}
const missing = { ok: false, reason: 'không đủ dữ liệu' };
it('Graham all pass, EPS4 BVPS25 => sqrt2250=47.4341649025; MOS giá20 = 57.8363%', () => {
  const r = graham(fixture(), 20, now);
  expect(r.score).toBe(100);
  expect(r.coverage).toBe(1);
  expect(r.intrinsicVnd).toEqual({ ok: true, value: Math.sqrt(2250) });
  expect(r.marginOfSafety.ok && r.marginOfSafety.value).toBeCloseTo(
    Number('0.5783629786442161'),
    10,
  );
  expect(r.criteria.every((c) => c.status === 'pass')).toBe(true);
});
it('DCF Owner Earnings100, g10%, r10%, terminal0, shares10: PV100+100 + terminal1000 =>120', () => {
  expect(ownerEarningsDcf(100, 10, settings)).toEqual({ ok: true, value: 120 });
  const r = buffett(fixture(), 20, now, settings);
  // 6 tiêu chí khác đạt tổng90; DCF proxy chưa xác minh là unknown10 điểm.
  expect(r.score).toBe(90);
  expect(r.scenario.valueVnd).toEqual({ ok: true, value: 120 });
  expect(r.intrinsicVnd).toEqual(missing);
  // MOS120,price20 = 1−20/120 = 5/6.
  expect(
    r.scenario.marginOfSafety.ok && r.scenario.marginOfSafety.value,
  ).toBeCloseTo(5 / 6, 12);
});
it('Không đủ EPS, EPS âm, BVPS0, thiếu năm/chuỗi đứt: unknown và không NaN', () => {
  for (const d of [
    null,
    { ...fixture(), supported: false },
    { ...fixture(), annual: [] },
    { ...fixture(), currentShares: 11 },
  ]) {
    const r = graham(d, 20, now);
    expect(r.intrinsicVnd).toEqual(missing);
    expect(Number.isFinite(r.score)).toBe(true);
  }
  for (const [eps, bvps] of [
    [-1, 25],
    [4, 0],
    [null, 25],
    [NaN, 25],
    [4, Infinity],
  ] as const) {
    const d = fixture();
    d.annual[2]!.epsAnnualVnd = eps;
    d.annual[2]!.bvpsVnd = bvps;
    expect(graham(d, 20, now).intrinsicVnd).toEqual(missing);
  }
  const d = fixture();
  d.annual = d.annual.slice(1);
  expect(
    graham(d, 20, now).criteria.find((c) => c.id === 'earnings')!.status,
  ).toBe('unknown');
  d.annual = [year(2021, 0), year(2024, 1), year(2025, 2)];
  expect(
    buffett(d, 20, now, settings).criteria.find((c) => c.id === 'roe')!.status,
  ).toBe('unknown');
  expect(graham(fixture(), null, now).marginOfSafety).toEqual(missing);
});
it('Graham nợ/vốn lưu động âm, EPS âm, mất cổ tức/lợi nhuận: fail hoặc unknown đúng nghĩa', () => {
  const d = fixture();
  for (const a of d.annual) {
    a.currentAssetsVnd = 20;
    a.currentLiabilitiesVnd = 100;
    a.longTermLiabilitiesVnd = 50;
    a.parentProfitVnd = -1;
    a.dividendsPaidVnd = 0;
  }
  const r = graham(d, 200, now);
  expect(r.criteria.every((c) => c.status === 'fail')).toBe(true);
  expect(r.score).toBe(0);
  d.annual[2]!.currentLiabilitiesVnd = 0;
  d.annual[2]!.longTermLiabilitiesVnd = null;
  expect(
    graham(d, 20, now).criteria.find((c) => c.id === 'liquidity')!.status,
  ).toBe('unknown');
  expect(
    graham(d, 20, now).criteria.find((c) => c.id === 'long-debt')!.status,
  ).toBe('unknown');
});
it('Buffett chặn biến động ROE/biên lớn, nợ cao, FCF/lợi nhuận giảm', () => {
  const d = fixture();
  d.annual[2]!.roe = 0.01;
  d.annual[2]!.grossMargin = 0.1;
  d.annual[2]!.netMargin = 0.01;
  d.annual[2]!.roic = 0.01;
  d.annual[2]!.debtToEquity = 0.9;
  d.annual[2]!.freeCashFlowVnd = -1;
  d.annual[2]!.parentProfitVnd = -1;
  expect(buffett(d, 1000, now, settings).score).toBe(0);
  for (const a of d.annual) {
    a.roe = null;
    a.grossMargin = null;
    a.netMargin = null;
    a.freeCashFlowVnd = null;
    a.parentProfitVnd = null;
    a.roic = null;
    a.debtToEquity = null;
    a.operatingCashFlowVnd = null;
  }
  expect(
    buffett(d, 20, now, settings).criteria.every((c) => c.status === 'unknown'),
  ).toBe(true);
  for (const proxy of [null, 0, -1, NaN, Infinity])
    expect(ownerEarningsDcf(proxy, 10, settings)).toEqual(missing);
  for (const shares of [null, 0, -1, NaN, Infinity])
    expect(ownerEarningsDcf(100, shares, settings)).toEqual(missing);
  expect(
    ownerEarningsDcf(100, 10, { ...settings, terminalGrowth: 0.1 }),
  ).toEqual(missing);
  d.annual[2]!.operatingCashFlowVnd = 100;
  d.annual[2]!.capexVnd = null;
  expect(buffett(d, 20, now, settings).intrinsicVnd).toEqual(missing);
});
it('Trọng số 25/75 với Graham100 Buffett0 =>25; không tái phân bổ điểm thiếu', () => {
  const d = fixture();
  for (const a of d.annual) {
    a.roe = 0.1;
    a.roic = 0.1;
    a.grossMargin = 0.1;
    a.netMargin = 0.01;
    a.debtToEquity = 0.9;
    a.freeCashFlowVnd = -1;
    a.operatingCashFlowVnd = -1;
    a.parentProfitVnd = 10;
  }
  const r = scoreStock(
    d,
    20,
    now,
    { ...defaultSettings, grahamWeight: 25, buffettWeight: 75 },
    now,
  );
  expect(r.strategies[0]!.score).toBe(100);
  expect(r.strategies[1]!.score).toBe(0);
  expect(r.score).toBe(25);
  expect(r.conclusion).toBe('Quan sát');
  const empty = scoreStock(null, null, now);
  expect(empty.score).toBeNull();
  expect(empty.confidence).toBe(0);
  expect(empty.conclusion).toBe('Quan sát');
});
it('Không dùng BCTC tương lai/chưa kiểm toán, duplicate và giá cũ để kết luận mua', () => {
  const d = fixture();
  d.annual[2]!.publishedAt = '2027-01-01T00:00:00Z';
  expect(availableAnnual(d, now)).toHaveLength(2);
  d.annual[1]!.audited = false;
  d.annual[0]!.consolidated = false;
  expect(availableAnnual(d, now)).toHaveLength(0);
  expect(availableAnnual(fixture(), 'not-date')).toEqual([]);
  const duplicate = fixture();
  duplicate.annual.push(duplicate.annual[2]!);
  expect(availableAnnual(duplicate, now)).toEqual([]);
  const r = scoreStock(
    fixture(),
    20,
    now,
    defaultSettings,
    '2025-01-01T00:00:00Z',
  );
  expect(r.conclusion).toBe('Quan sát');
  expect(r.risks.join()).toContain('24 giờ');
  expect(r.confidence).toBeLessThan(30);
  const stale = fixture();
  stale.annual = stale.annual.slice(0, 1);
  expect(
    scoreStock(stale, 20, now, defaultSettings, now).risks.join(),
  ).toContain('550');
  expect(
    scoreStock(
      fixture(),
      20,
      now,
      { ...defaultSettings, grahamWeight: 100, buffettWeight: 0 },
      now,
      {
        sourceTimestamp: now,
        sessionDate: '2026-10-13',
        verification: 'verified',
      },
    ).confidence,
  ).toBe(65);
});
it('Định nghĩa kết luận và biên ngưỡng; confidence là bằng chứng, không xác suất', () => {
  expect(conclusion(90, 80, 0.3)).toBe('Mua');
  expect(conclusion(70, 80, 0.15)).toBe('Tích lũy');
  expect(conclusion(55, 80, 0.01)).toBe('Nắm giữ');
  expect(conclusion(20, 80, 0.3)).toBe('Tránh');
  expect(conclusion(90, 80, -0.3)).toBe('Tránh');
  expect(conclusion(45, 80, 0.1)).toBe('Quan sát');
  expect(conclusion(90, 69, 0.3)).toBe('Quan sát');
  expect(conclusion(90, 80, null)).toBe('Quan sát');
});
it('Settings và phép chia bảo vệ đầu vào không hợp lệ', () => {
  expect(validateSettings(defaultSettings)).toBe(true);
  for (const v of [
    null,
    [],
    {},
    { ...defaultSettings, grahamWeight: NaN },
    { ...defaultSettings, grahamWeight: 51 },
    { ...defaultSettings, projectionYears: 1.5 },
    { ...defaultSettings, maintenanceCapexFraction: 2 },
    { ...defaultSettings, growthRate: 0.3 },
    { ...defaultSettings, discountRate: 0 },
    { ...defaultSettings, terminalGrowth: 0.12 },
  ])
    expect(validateSettings(v)).toBe(false);
  expect(() =>
    scoreStock(null, null, now, { ...defaultSettings, buffettWeight: 0 }),
  ).toThrow('không hợp lệ');
  for (const [a, b] of [
    [null, 1],
    [1, 0],
    [NaN, 1],
    [1, Infinity],
    [1e308, 1e-308],
  ])
    expect(ratio(a, b)).toBeNull();
  expect(ratio(10, 2)).toBe(5);
  expect(consecutiveSeries([], (r) => r.roe)).toBeNull();
});

it('Giá0 không là bội số hợp lệ; cổ tức tập đoàn có NCI chưa đủ để kết luận cổ tức công ty mẹ', () => {
  const d = fixture();
  d.annual[2]!.minorityEquityVnd = 10;
  expect(
    graham(d, 20, now).criteria.find((c) => c.id === 'dividends')!.status,
  ).toBe('unknown');
  expect(
    graham(d, 0, now).criteria.find((c) => c.id === 'multiples')!.status,
  ).toBe('unknown');
});
