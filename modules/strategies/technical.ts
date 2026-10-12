import { finiteResult, insufficient, positive, type Result } from './result';

function validSeries(
  values: readonly number[] | null,
  length: number,
): values is readonly number[] {
  return !!values && values.length >= length && values.every(positive);
}
function validPeriod(period: number): boolean {
  return Number.isInteger(period) && period > 0;
}

// Wilder: seed = SMA của period thay đổi đầu; tiếp theo (prev*(p-1)+x)/p.
export function rsi(
  closes: readonly number[] | null,
  period = 14,
): Result<number> {
  if (!validPeriod(period) || !validSeries(closes, period + 1))
    return insufficient();
  let gain = 0,
    loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    const up = Math.max(delta, 0),
      down = Math.max(-delta, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
  }
  // technicalindicators định nghĩa chuỗi phẳng là 100 (loss = 0).
  return finiteResult(
    loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss),
  );
}

export interface Candle {
  high: number;
  low: number;
  close: number;
}
function validCandles(
  candles: readonly (Candle | null)[],
): candles is readonly Candle[] {
  return candles.every(
    (c) =>
      c !== null &&
      positive(c.high) &&
      positive(c.low) &&
      positive(c.close) &&
      c.high >= c.low &&
      c.close >= c.low &&
      c.close <= c.high,
  );
}
export function atr(
  candles: readonly (Candle | null)[] | null,
  period = 14,
): Result<number> {
  if (
    !validPeriod(period) ||
    !candles ||
    candles.length < period + 1 ||
    !validCandles(candles)
  )
    return insufficient();
  let value = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!,
      prev = candles[i - 1]!.close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev),
      Math.abs(c.low - prev),
    );
    value =
      i <= period ? value + tr / period : (value * (period - 1) + tr) / period;
  }
  return finiteResult(value);
}

function ema(values: readonly number[], period: number): number[] {
  const output: number[] = [];
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  output.push(value);
  for (let i = period; i < values.length; i++) {
    value += ((values[i]! - value) * 2) / (period + 1);
    output.push(value);
  }
  return output;
}
export interface Macd {
  macd: number;
  signal: number;
  histogram: number;
}
export function macd(
  closes: readonly number[] | null,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): Result<Macd> {
  if (
    ![fast, slow, signalPeriod].every(validPeriod) ||
    fast >= slow ||
    !validSeries(closes, slow + signalPeriod - 1)
  )
    return insufficient();
  const fastEma = ema(closes, fast),
    slowEma = ema(closes, slow);
  const line = slowEma.map((v, i) => fastEma[i + slow - fast]! - v);
  const m = line.at(-1)!,
    s = ema(line, signalPeriod).at(-1)!,
    h = m - s;
  return [m, s, h].every(Number.isFinite)
    ? { ok: true, value: { macd: m, signal: s, histogram: h } }
    : insufficient();
}

export function fibonacci(
  low?: number | null,
  high?: number | null,
): Result<Record<'0.236' | '0.382' | '0.5' | '0.618' | '0.786', number>> {
  if (!positive(low) || !positive(high) || high <= low) return insufficient();
  // Retracement của nhịp tăng low→high, đo xuống từ high.
  const value = {
    '0.236': high - (high - low) * 0.236,
    '0.382': high - (high - low) * 0.382,
    '0.5': high - (high - low) * 0.5,
    '0.618': high - (high - low) * 0.618,
    '0.786': high - (high - low) * 0.786,
  };
  return Object.values(value).every(Number.isFinite)
    ? { ok: true, value }
    : insufficient();
}
