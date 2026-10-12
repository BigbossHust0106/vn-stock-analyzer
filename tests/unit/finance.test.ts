import { describe, expect, it } from 'vitest';
import { ATR, MACD, RSI } from 'technicalindicators';
import { grahamNumber, dcf } from '../../modules/strategies/valuation';
import { marginOfSafety } from '../../modules/scoring/margin-of-safety';
import { rsi, atr, macd, fibonacci } from '../../modules/strategies/technical';
import { finiteResult, type Result } from '../../modules/strategies/result';

function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}
const missing = { ok: false, reason: 'không đủ dữ liệu' };

describe('Định giá — đáp án độc lập, cùng đơn vị VND', () => {
  it('Graham: sqrt(22.5 * 4 * 25) = sqrt(2250) = 47.4341649025', () => {
    // EPS = 4, BVPS = 25; không suy ra EPS năm từ EPS quý.
    expect(value(grahamNumber(4, 25))).toBeCloseTo(47.4341649025, 8);
    // Cùng dữ liệu nhân 1000: sqrt(22.5*4000*25000) = 47434.1649025 VND.
    expect(value(grahamNumber(4000, 25000))).toBeCloseTo(47434.1649025, 6);
  });
  it.each([
    [-1, 25],
    [0, 25],
    [4, 0],
    [4, -1],
    [NaN, 25],
    [Infinity, 25],
    [4, Infinity],
    [null, 25],
    [4, null],
    [undefined, 25],
  ])('Graham thiếu/không hợp lệ %s %s', (a, b) =>
    expect(grahamNumber(a, b)).toEqual(missing),
  );
  it('Biên an toàn: 1 - 75/100 = 0.25; 1 - 120/100 = -0.2', () => {
    expect(value(marginOfSafety(100, 75))).toBe(0.25);
    expect(value(marginOfSafety(100, 120))).toBeCloseTo(-0.2, 12);
  });
  it.each([
    [0, 1],
    [-1, 1],
    [100, 0],
    [100, -1],
    [NaN, 1],
    [100, Infinity],
    [null, 1],
    [100, undefined],
  ])('MOS thiếu dữ liệu %s %s', (a, b) =>
    expect(marginOfSafety(a, b)).toEqual(missing),
  );
  it('DCF FCFE: [110,121], r=10%, g=0, shares=10 → 120', () => {
    // PV = 110/1.1 + 121/1.21 = 200; terminal = 121/0.1 = 1210;
    // PV terminal = 1210/1.21 = 1000; tổng 1200/10 = 120 VND/cổ phiếu.
    expect(value(dcf([110, 121], 0.1, 0, 10))).toBeCloseTo(120, 10);
    // Một kỳ: [110], r=.1, g=0, shares=10: (100+1000)/10=110.
    expect(value(dcf([110], 0.1, 0, 10))).toBeCloseTo(110, 10);
  });
  it('DCF chặn mẫu số 0, NaN, thiếu FCFE và shares', () => {
    for (const flows of [null, [], [-1], [0], [NaN], [Infinity]])
      expect(dcf(flows, 0.1, 0, 10)).toEqual(missing);
    for (const r of [0, -1, NaN, Infinity])
      expect(dcf([110], r, 0, 10)).toEqual(missing);
    for (const g of [0.1, 0.2, -1, NaN, Infinity])
      expect(dcf([110], 0.1, g, 10)).toEqual(missing);
    for (const s of [0, -1, NaN, Infinity])
      expect(dcf([110], 0.1, 0, s)).toEqual(missing);
    expect(dcf([Number.MAX_VALUE], 0.1, 0, 1)).toEqual(missing);
    expect(grahamNumber(Number.MAX_VALUE, Number.MAX_VALUE)).toEqual(missing);
    expect(marginOfSafety(Number.MIN_VALUE, Number.MAX_VALUE)).toEqual(missing);
    expect(finiteResult(Infinity)).toEqual(missing);
  });
});

describe('Chỉ báo — Wilder / EMA SMA-seeded / retracement nhịp tăng', () => {
  it('RSI p=2: [10,11,10] gains=.5, losses=.5 → 50', () => {
    expect(value(rsi([10, 11, 10], 2))).toBe(50);
    // Thêm 12: gain=(.5+2)/2=1.25, loss=(.5+0)/2=.25; RSI=100-100/6.
    expect(value(rsi([10, 11, 10, 12], 2))).toBeCloseTo(83.3333333333, 8);
    expect(value(rsi([10, 11, 12], 2))).toBe(100);
    expect(value(rsi([12, 11, 10], 2))).toBe(0);
    expect(value(rsi([10, 10, 10], 2))).toBe(100);
  });
  it('ATR p=2: TR 3 và 4 → 3.5; Wilder kế tiếp (3.5+2)/2=2.75', () => {
    const bars = [
      { high: 11, low: 9, close: 10 },
      { high: 13, low: 10, close: 12 },
      { high: 14, low: 10, close: 13 },
      { high: 14, low: 12, close: 13 },
    ];
    expect(value(atr(bars.slice(0, 3), 2))).toBe(3.5);
    expect(value(atr(bars, 2))).toBe(2.75);
    // Gap: prev close=10, high=15,low=14 → TR=5, không phải high-low=1.
    expect(
      value(
        atr(
          [
            { high: 11, low: 9, close: 10 },
            { high: 15, low: 14, close: 14 },
          ],
          1,
        ),
      ),
    ).toBe(5);
  });
  it('MACD fast=2 slow=3 signal=2 trên [1..5] → .5/.5/0', () => {
    // EMA2 seed=1.5 rồi 2.5,3.5,4.5; EMA3 seed=2 rồi 3,4.
    // MACD=[.5,.5,.5]; signal EMA2=.5; histogram=0.
    const actual = value(macd([1, 2, 3, 4, 5], 2, 3, 2));
    expect(actual.macd).toBeCloseTo(0.5, 12);
    expect(actual.signal).toBeCloseTo(0.5, 12);
    expect(actual.histogram).toBeCloseTo(0, 12);
  });
  it('Fibonacci low=100 high=200: high - 100 * ratio', () => {
    const actual = value(fibonacci(100, 200));
    // 200-100*.786=121.4; dùng tolerance cho số chấm động, không sửa đáp án.
    for (const [ratio, expected] of Object.entries({
      '0.236': 176.4,
      '0.382': 161.8,
      '0.5': 150,
      '0.618': 138.2,
      '0.786': 121.4,
    }))
      expect(actual[ratio as keyof typeof actual]).toBeCloseTo(expected, 10);
  });
  it('Không đủ chuỗi / period / OHLC / dữ liệu', () => {
    for (const prices of [
      null,
      [],
      [1],
      [1, 0, 2],
      [1, NaN, 2],
      [1, Infinity, 2],
      [1, -1, 2],
    ]) {
      expect(rsi(prices, 2)).toEqual(missing);
      expect(macd(prices, 2, 3, 2)).toEqual(missing);
    }
    for (const p of [0, -1, 1.5, Infinity, NaN]) {
      expect(rsi([1, 2, 3], p)).toEqual(missing);
      expect(atr([], p)).toEqual(missing);
      expect(macd([1, 2, 3, 4, 5], p, 3, 2)).toEqual(missing);
    }
    expect(macd([1, 2, 3, 4], 3, 2, 2)).toEqual(missing);
    expect(atr(null)).toEqual(missing);
    expect(atr([null, { high: 2, low: 1, close: 1 }], 1)).toEqual(missing);
    expect(atr([])).toEqual(missing);
    expect(
      atr(
        [
          { high: 1, low: 2, close: 1 },
          { high: 2, low: 1, close: 3 },
        ],
        1,
      ),
    ).toEqual(missing);
    expect(
      atr(
        [
          { high: 2, low: 1, close: 1 },
          { high: 2, low: 1, close: NaN },
        ],
        1,
      ),
    ).toEqual(missing);
    for (const [a, b] of [
      [null, 2],
      [1, undefined],
      [1, 0],
      [0, 2],
      [-1, 2],
      [2, 2],
      [3, 2],
      [1, NaN],
      [Infinity, 2],
    ] as const)
      expect(fibonacci(a, b)).toEqual(missing);
  });
  it('RSI/ATR/MACD lệch < 0.01 so với technicalindicators trên cùng chuỗi', () => {
    // Tất cả giá thuộc cùng price basis; không trộn adjusted/unadjusted.
    const closes = Array.from(
      { length: 80 },
      (_, i) => 100 + i / 3 + (i % 7) - 3,
    );
    const bars = closes.map((c) => ({ high: c + 2, low: c - 1, close: c }));
    const referenceRsi = RSI.calculate({ values: closes, period: 14 }).at(-1)!;
    expect(Math.abs(value(rsi(closes)) - referenceRsi)).toBeLessThan(0.01);
    const referenceAtr = ATR.calculate({
      high: bars.map((c) => c.high),
      low: bars.map((c) => c.low),
      close: closes,
      period: 14,
    }).at(-1)!;
    expect(Math.abs(value(atr(bars)) - referenceAtr)).toBeLessThan(0.01);
    const referenceMacd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }).at(-1)!;
    const actual = value(macd(closes));
    expect(Math.abs(actual.macd - referenceMacd.MACD!)).toBeLessThan(0.01);
    expect(Math.abs(actual.signal - referenceMacd.signal!)).toBeLessThan(0.01);
    expect(Math.abs(actual.histogram - referenceMacd.histogram!)).toBeLessThan(
      0.01,
    );
  });
});
