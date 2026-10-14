import { describe, it, expect } from 'vitest';
import {
  buildTradePlan,
  riskReward,
  validPlanBars,
  pivots,
  accumulationNode,
  historicalPeTarget,
  sellAlerts,
  type PlanBar,
  type TradePlanInput,
} from '../../modules/trading/trade-plan';
import {
  roundPrice,
  sessionBand,
  bandState,
  tickSize,
} from '../../modules/trading/exchange-rules';
import {
  defaultTradeSettings,
  validTradeSettings,
} from '../../modules/settings/trade-plan-settings';
import { fibonacciExtension } from '../../modules/strategies/technical';
import {
  numericFields,
  type AnnualFinancials,
  type FinancialData,
} from '../../modules/providers/financial-types';
const asOf = '2026-10-14T09:00:00Z';
function bars(closes: number[]): PlanBar[] {
  return closes.map((c, i) => ({
    symbol: 'TST',
    sessionDate: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
    openVnd: c,
    highVnd: c + 100,
    lowVnd: c - 100,
    closeVnd: c,
    volumeReported: 1000,
    source: 'test',
    priceBasis: 'unverified',
    isFinal: false,
  }));
}
const series = () =>
  bars(
    Array.from(
      { length: 106 },
      (_, i) => 30000 + 2000 * Math.sin((i * Math.PI) / 10),
    ),
  );
function input(patch: Partial<TradePlanInput> = {}): TradePlanInput {
  return {
    symbol: 'TST',
    exchange: 'HOSE',
    bars: series(),
    financials: null,
    priceVnd: 30000,
    referenceVnd: 30000,
    settings: { ...defaultTradeSettings },
    asOf,
    ...patch,
  };
}
const level = (p: ReturnType<typeof buildTradePlan>, id: string) =>
  p.levels.find((l) => l.id === id)!;
function financials(): FinancialData {
  return {
    symbol: 'TST',
    source: 'KBS_VIETCAP',
    verification: 'provider_reported',
    fetchedAt: asOf,
    businessType: 1,
    supported: true,
    currentShares: 100,
    notices: [],
    annual: [2023, 2024, 2025].map(
      (year) =>
        ({
          ...Object.fromEntries(numericFields.map((k) => [k, null])),
          year,
          periodEnd: `${year}-12-31`,
          publishedAt: `${year + 1}-03-31T00:00:00Z`,
          audited: true,
          consolidated: true,
          epsAnnualVnd: 4000,
          bvpsVnd: 25000,
          sharesOutstanding: 100,
        }) as AnnualFinancials,
    ),
  };
}
describe('Bước giá và biên độ Việt Nam', () => {
  it('đổi bước tại 10k/50k, hướng làm tròn thận trọng', () => {
    expect(roundPrice(9999.9, 'HOSE', 'up')).toBe(10000);
    expect(roundPrice(9999.9, 'HOSE', 'down')).toBe(9990);
    expect(roundPrice(49999.9, 'HOSE', 'up')).toBe(50000);
    expect(roundPrice(49999.9, 'HOSE', 'down')).toBe(49950);
    expect(roundPrice(50101, 'HOSE', 'down')).toBe(50100);
    expect(roundPrice(10001, 'HNX', 'up')).toBe(10100);
    expect(roundPrice(9999, 'UPCOM', 'down')).toBe(9900);
    for (const n of [0, -1, NaN, Infinity, 1e13])
      expect(roundPrice(n, 'HOSE', 'up')).toBeNull();
  });
  it('30.000 × (1±7/10/15%); ưu tiên trần/sàn nguồn phiên đặc biệt', () => {
    expect(sessionBand('HOSE', 30000)).toMatchObject({
      floor: 27900,
      ceiling: 32100,
    });
    expect(sessionBand('HNX', 30000)).toMatchObject({
      floor: 27000,
      ceiling: 33000,
    });
    expect(sessionBand('UPCOM', 30000)).toMatchObject({
      floor: 25500,
      ceiling: 34500,
    });
    const special = sessionBand('HOSE', 30000, 24000, 36000);
    expect(special).toMatchObject({ floor: 24000, ceiling: 36000 });
    expect(bandState(40000, special)).toBe('Trên trần phiên');
    expect(bandState(23000, special)).toBe('Dưới sàn phiên');
    expect(sessionBand('HOSE', null)).toBeNull();
    expect(sessionBand('HOSE', 10)).toBeNull();
  });
});
it('Fibonacci extension 100→200: 100+1.272×100=227.2, 261.8, 361.8', () => {
  const r = fibonacciExtension(100, 200);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value['1.272']).toBeCloseTo(227.2, 10);
    expect(r.value['1.618']).toBeCloseTo(261.8, 10);
    expect(r.value['2.618']).toBeCloseTo(361.8, 10);
  }
  for (const [a, b] of [
    [0, 200],
    [200, 100],
    [100, 100],
    [100, Infinity],
    [null, 200],
  ] as const)
    expect(fibonacciExtension(a, b).ok).toBe(false);
});
describe('Vùng giá, dữ liệu thiếu và R:R', () => {
  it('không tạo TP nếu không có cơ sở, không biến thiếu dữ liệu thành 0', () => {
    const p = buildTradePlan(input({ bars: [], priceVnd: null }));
    expect(p.levels.every((l) => l.price === null)).toBe(true);
    expect(p.alerts.every((a) => a.status === 'unknown')).toBe(true);
    expect(p.atrVnd).toBeNull();
    expect(riskReward(100, 90, 120)).toBe(2); // (120−100)/(100−90)=2
    for (const tuple of [
      [100, 100, 120],
      [100, 110, 120],
      [100, 90, 80],
      [null, 90, 120],
      [Infinity, 90, 120],
    ] as const)
      expect(riskReward(tuple[0], tuple[1], tuple[2])).toBeNull();
  });
  it('TP chỉ lấy ứng viên đạt R:R≥2 sau làm tròn; không ép về trần hôm nay', () => {
    const p = buildTradePlan(
      input({
        financials: financials(),
        settings: {
          ...defaultTradeSettings,
          entryPriceVnd: 30000,
          stopMethod: 'percent',
        },
      }),
    );
    const stop = level(p, 'stop').price!;
    expect(stop).toBe(27600); // 30.000×.92=27.600
    const tps = p.levels.filter(
      (l) => l.id.startsWith('tp') && l.price !== null,
    );
    expect(tps.length).toBeGreaterThan(0);
    for (const l of p.levels.filter((l) => l.price !== null))
      expect(l.price! % tickSize(l.price!, 'HOSE')).toBe(0);
    for (const l of tps) {
      expect(l.rr).toBeGreaterThanOrEqual(2);
      expect(l.rr).toBe((l.price! - 30000) / (30000 - stop));
    }
    expect(
      tps.some((t) => t.price! > 32100 && t.band === 'Trên trần phiên'),
    ).toBe(true);
    expect(level(p, 'buy-high').price!).toBeLessThanOrEqual(
      Math.sqrt(22.5 * 4000 * 25000) * 0.75,
    );
  });
  it('không tăng ứng viên yếu để đủ 2:1 và không quá cap lỗ sau làm tròn', () => {
    const p = buildTradePlan(
      input({
        settings: {
          ...defaultTradeSettings,
          entryPriceVnd: 50001,
          stopMethod: 'percent',
          maxLoss: 0.005,
        },
      }),
    );
    expect(level(p, 'entry').price).toBe(50100);
    expect(level(p, 'stop').price).toBe(49850); // cap 49849.5 → roundup 49850
    expect(
      p.levels
        .filter((l) => l.id.startsWith('tp'))
        .every((l) => l.price === null),
    ).toBe(true);
    const q = buildTradePlan(
      input({
        settings: {
          ...defaultTradeSettings,
          entryPriceVnd: 1000,
          atrMultiple: 5,
        },
      }),
    );
    expect(level(q, 'stop').price).toBe(920); // ATR stop âm vẫn phải siết cap 8%, không mất SL.
  });
  it('ATR/đáy gần nhất đều tôn trọng mức lỗ tối đa', () => {
    for (const stopMethod of ['atr', 'swing'] as const) {
      const p = buildTradePlan(
        input({
          settings: {
            ...defaultTradeSettings,
            entryPriceVnd: 30000,
            stopMethod,
            maxLoss: 0.03,
          },
        }),
      );
      expect(level(p, 'stop').price).toBeGreaterThanOrEqual(29100);
      expect(level(p, 'stop').price).toBeLessThan(30000);
    }
  });
  it('không trộn giá điều chỉnh/nguồn, không dùng OHLC sai hay lịch sử cũ', () => {
    const b = series();
    expect(validPlanBars(b, 'TST', asOf)).toBe(true);
    for (const patch of [
      { symbol: 'BAD' },
      { priceBasis: 'adjusted' as const },
      { source: 'other' },
      { highVnd: 1 },
      { volumeReported: -1 },
      { sessionDate: '2026-10-15' },
      { sessionDate: b[0]!.sessionDate },
    ]) {
      const broken = b.map((x, i) => (i === 5 ? { ...x, ...patch } : x));
      expect(validPlanBars(broken, 'TST', asOf)).toBe(false);
      expect(buildTradePlan(input({ bars: broken })).atrVnd).toBeNull();
    }
    const stale = buildTradePlan(input({ asOf: '2026-11-01T00:00:00Z' }));
    expect(stale.atrVnd).toBeNull();
    expect(level(stale, 'buy-low').price).toBeNull();
    const f = financials();
    f.annual.at(-1)!.epsAnnualVnd = -1;
    expect(buildTradePlan(input({ financials: f })).intrinsicVnd).toBeNull();
  });
});
describe('Trailing stop theo vị thế', () => {
  it('bỏ high ngày vào, chỉ tăng và không giả định khớp khi giá vượt xuống', () => {
    const b = series();
    b.at(-2)!.highVnd = 90000;
    const s = {
      ...defaultTradeSettings,
      entryPriceVnd: 30000,
      entryDate: b.at(-2)!.sessionDate,
      trailing: true,
      stopMethod: 'percent' as const,
    };
    const p = buildTradePlan(input({ bars: b, settings: s }));
    expect(p.highWaterVnd).toBe(b.at(-1)!.highVnd); // không lấy 90k trước giờ mua chưa biết.
    const q = buildTradePlan(
      input({
        bars: b,
        settings: { ...s, highWaterVnd: 40000, trailingStopVnd: 37500 },
      }),
    );
    expect(q.highWaterVnd).toBe(40000);
    expect(q.trailingStopVnd).toBe(37500); // max(40000*.92=36800,37500,SL)
    expect(level(q, 'trailing').reason).toContain('không giả định đã bán');
    for (const settings of [
      { ...s, entryDate: null },
      { ...s, entryDate: '2026-10-15' },
      { ...s, entryPriceVnd: null },
    ])
      expect(buildTradePlan(input({ settings })).trailingStopVnd).toBeNull();
  });
});
it('đỉnh phải được xác nhận 2 nến bên phải; nút KL là proxy, không tự có khi KL=0', () => {
  const b = bars([1000, 1100, 1500, 1100, 1000, 1600]);
  expect(pivots(b, 'high').map((p) => p.index)).toEqual([2]);
  const flat = bars(Array(30).fill(30000));
  expect(accumulationNode(flat)?.share).toBe(1);
  expect(
    accumulationNode(flat.map((b) => ({ ...b, volumeReported: 0 }))),
  ).toBeNull();
  expect(accumulationNode(flat.slice(0, 10))).toBeNull();
});
it('P/E của chính mã: cùng năm, ≥3 mốc unadjusted/final, không dùng EPS quý hoặc backfill', () => {
  const f = financials();
  const b = bars([32000, 40000, 48000]).map((b, i) => ({
    ...b,
    sessionDate: `${2023 + i}-12-31`,
    priceBasis: 'unadjusted' as const,
    isFinal: true,
  }));
  // PE=[8,10,12], trung vị10 × EPS2025=4000 →40.000VND.
  expect(historicalPeTarget(f, b, asOf)?.price).toBe(40000);
  expect(
    historicalPeTarget(
      f,
      b.map((b) => ({ ...b, priceBasis: 'unverified' })),
      asOf,
    ),
  ).toBeNull();
  expect(
    historicalPeTarget(
      f,
      b.map((b) => ({ ...b, isFinal: false })),
      asOf,
    ),
  ).toBeNull();
  expect(historicalPeTarget(f, b.slice(1), asOf)).toBeNull();
  f.annual[0]!.sharesOutstanding = 50;
  expect(historicalPeTarget(f, b, asOf)).toBeNull();
});
it('cảnh báo định giá/thanh khoản: ngưỡng rõ; thiếu nền không được kết luận an toàn', () => {
  const b = series().map((b, i) => ({
    ...b,
    volumeReported: i >= 101 ? 100 : 1000,
  }));
  const a = sellAlerts(b, 50000, 40000);
  expect(a.find((a) => a.id === 'valuation')?.status).toBe('triggered'); // 1.25>1.2
  expect(a.find((a) => a.id === 'liquidity')?.status).toBe('triggered'); // 100/1000=.1<.4
  expect(
    sellAlerts(
      b.map((b) => ({ ...b, volumeReported: 0 })),
      null,
      null,
    ).find((a) => a.id === 'liquidity')?.status,
  ).toBe('unknown');
  expect(
    sellAlerts(b.slice(0, 10), 30000, 40000).find((a) => a.id === 'rsi')
      ?.status,
  ).toBe('unknown');
});
it('chặn cài đặt không hữu hạn, %/ngày sai', () => {
  expect(validTradeSettings(defaultTradeSettings)).toBe(true);
  for (const patch of [
    { maxLoss: 0 },
    { maxLoss: NaN },
    { trailingPercent: Infinity },
    { entryDate: '2026-02-30' },
    { entryPriceVnd: -1 },
    { atrMultiple: 8 },
  ])
    expect(validTradeSettings({ ...defaultTradeSettings, ...patch })).toBe(
      false,
    );
  expect(() => buildTradePlan(input({ asOf: 'broken' }))).toThrow();
});
it('phân kỳ giảm dùng đúng hai đỉnh, chỉ báo tại từng đỉnh và không nhìn nến sau', () => {
  const closes = Array.from({ length: 65 }, (_, i) =>
    i < 40
      ? 10000 + i * 300
      : i < 60
        ? 21000 + (i - 40) * 20 + (i % 2) * 200
        : 20800 - (i - 60) * 50,
  );
  const b = bars(closes);
  b[39]!.highVnd = 25000;
  b[59]!.highVnd = 26000;
  const alerts = sellAlerts(b, 21000, null);
  expect(alerts.find((a) => a.id === 'rsi')?.status).toBe('triggered');
  expect(alerts.find((a) => a.id === 'macd')?.status).toBe('triggered');
  // Hai đỉnh high 25k→26k; RSI đầu =100 (39 phiên toàn tăng), sau có lỗ nên giảm.
  // MACD đầu phản ánh tốc độ +300/phiên, sau nhịp chậm chỉ +20 và dao động ±200.
  const changed = b.map((b, i) =>
    i > 59
      ? { ...b, closeVnd: 20000, openVnd: 20000, highVnd: 20100, lowVnd: 19900 }
      : b,
  );
  expect(
    sellAlerts(changed, 21000, null).filter((a) =>
      ['rsi', 'macd'].includes(a.id),
    ),
  ).toEqual(alerts.filter((a) => ['rsi', 'macd'].includes(a.id)));
});
it('đỉnh cũ chỉ là hỗ trợ sau hai nến cuối đóng trên đỉnh, không khẳng định đã retest', () => {
  const b = series().map((b, i) =>
    i >= 100
      ? {
          ...b,
          openVnd: i === 100 ? 31000 : i <= 102 ? 30000 : 32000,
          closeVnd: i === 100 ? 31000 : i <= 102 ? 30000 : 32000,
          highVnd: i === 100 ? 31100 : i <= 102 ? 30100 : 32100,
          lowVnd: i === 100 ? 30900 : i <= 102 ? 29900 : 31900,
        }
      : b,
  );
  // Tách điều kiện đỉnh cũ khỏi nút khối lượng cạnh tranh cao hơn trong fixture sóng sin.
  for (const row of b) row.volumeReported = 0;
  const p = buildTradePlan(input({ bars: b, priceVnd: 32000 }));
  expect(level(p, 'buy-low').reason).toContain('Đỉnh cũ');
  expect(level(p, 'buy-low').reason).toContain('chưa xác nhận retest');
  b.at(-1)!.closeVnd = 30000;
  b.at(-1)!.lowVnd = 29900;
  expect(
    level(buildTradePlan(input({ bars: b, priceVnd: 32000 })), 'buy-low')
      .reason,
  ).not.toContain('Đỉnh cũ');
});
