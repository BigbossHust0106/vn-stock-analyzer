import type { Exchange } from '../providers/data-provider';
import type { FinancialData } from '../providers/financial-types';
import { availableAnnual } from '../strategies/strategy';
import { graham } from '../strategies/graham';
import {
  atr,
  rsi,
  macd,
  fibonacci,
  fibonacciExtension,
} from '../strategies/technical';
import { positive } from '../strategies/result';
import { validSourceDate } from '../providers/source-evidence';
import { vietnamDate } from '../market/calendar';
import {
  validTradeSettings,
  type TradePlanSettings,
} from '../settings/trade-plan-settings';
import { roundPrice, sessionBand, bandState, tickSize } from './exchange-rules';
export interface PlanBar {
  symbol: string;
  sessionDate: string;
  openVnd: number;
  highVnd: number;
  lowVnd: number;
  closeVnd: number;
  volumeReported: number;
  source: string;
  priceBasis: 'adjusted' | 'unadjusted' | 'unverified';
  isFinal: boolean;
}
export interface PlanLevel {
  id: string;
  label: string;
  price: number | null;
  reason: string;
  rr: number | null;
  band: string;
}
export interface PlanAlert {
  id: string;
  label: string;
  status: 'triggered' | 'clear' | 'unknown';
  reason: string;
}
export interface TradePlanInput {
  symbol: string;
  exchange: Exchange;
  bars: PlanBar[];
  financials: FinancialData | null;
  priceVnd: number | null;
  referenceVnd: number | null;
  floorVnd?: number | null;
  ceilingVnd?: number | null;
  asOf: string;
  settings: TradePlanSettings;
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const fmt = (v: number) =>
  v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
export function validPlanBars(bars: PlanBar[], symbol: string, asOf: string) {
  return (
    Number.isFinite(Date.parse(asOf)) &&
    bars.every(
      (b, i) =>
        b.symbol === symbol &&
        validSourceDate(b.sessionDate) &&
        b.sessionDate <= vietnamDate(Date.parse(asOf)) &&
        (i === 0 || b.sessionDate > bars[i - 1]!.sessionDate) &&
        [b.openVnd, b.highVnd, b.lowVnd, b.closeVnd].every(
          (v) => positive(v) && v <= 1e12,
        ) &&
        b.highVnd >= Math.max(b.openVnd, b.closeVnd, b.lowVnd) &&
        b.lowVnd <= Math.min(b.openVnd, b.closeVnd) &&
        Number.isSafeInteger(b.volumeReported) &&
        b.volumeReported >= 0 &&
        ['adjusted', 'unadjusted', 'unverified'].includes(b.priceBasis) &&
        b.source === bars[0]!.source &&
        b.priceBasis === bars[0]!.priceBasis,
    )
  );
}
/** Confirmed pivots use two bars on each side; the last two bars cannot form a confirmed pivot. */
export function pivots(bars: PlanBar[], side: 'high' | 'low') {
  const field = side === 'high' ? 'highVnd' : 'lowVnd';
  return bars.flatMap((b, i) =>
    i >= 2 &&
    i < bars.length - 2 &&
    [-2, -1, 1, 2].every((d) =>
      side === 'high'
        ? b[field] > bars[i + d]![field]
        : b[field] < bars[i + d]![field],
    )
      ? [{ index: i, price: b[field], date: b.sessionDate }]
      : [],
  );
}
export function riskReward(
  entry: number | null,
  stop: number | null,
  target: number | null,
) {
  const value =
    positive(entry) &&
    positive(stop) &&
    positive(target) &&
    stop < entry &&
    target > entry
      ? (target - entry) / (entry - stop)
      : null;
  return value !== null && Number.isFinite(value) ? value : null;
}
export function accumulationNode(bars: PlanBar[]) {
  const rows = bars.slice(-60);
  if (rows.length < 20) return null;
  const low = Math.min(...rows.map((b) => b.lowVnd)),
    high = Math.max(...rows.map((b) => b.highVnd));
  if (high <= low || rows.every((b) => b.volumeReported === 0)) return null;
  const bins = Array.from({ length: 12 }, () => 0);
  for (const b of rows)
    bins[Math.min(11, Math.floor(((b.closeVnd - low) / (high - low)) * 12))]! +=
      b.volumeReported;
  const i = bins.indexOf(Math.max(...bins));
  return {
    price: low + ((i + 0.5) * (high - low)) / 12,
    share: bins[i]! / bins.reduce((a, b) => a + b, 0),
  };
}
/** Year-end close paired with the same published annual EPS and unchanged share count; no current EPS backfill. */
export function historicalPeTarget(
  financials: FinancialData | null,
  bars: PlanBar[],
  asOf: string,
) {
  const rows = availableAnnual(financials, asOf),
    last = rows.at(-1);
  if (
    !last ||
    !positive(last.epsAnnualVnd) ||
    last.sharesOutstanding !== financials?.currentShares
  )
    return null;
  const values = rows
    .flatMap((y) => {
      const yearly = bars.filter((b) =>
        b.sessionDate.startsWith(String(y.year) + '-'),
      );
      const close = yearly.at(-1);
      return positive(y.epsAnnualVnd) &&
        y.sharesOutstanding === financials.currentShares &&
        close &&
        close.sessionDate >= `${y.year}-12-15` &&
        close.priceBasis === 'unadjusted' &&
        close.isFinal
        ? [close.closeVnd / y.epsAnnualVnd]
        : [];
    })
    .filter(positive)
    .sort((a, b) => a - b);
  if (values.length < 3) return null;
  const middle = Math.floor(values.length / 2),
    median =
      values.length % 2
        ? values[middle]!
        : (values[middle - 1]! + values[middle]!) / 2;
  const price = median * last.epsAnnualVnd;
  if (!positive(price) || price > 1e12) return null;
  return {
    price,
    reason: `Trung vị P/E cuối năm của chính mã: ${fmt(median)}× EPS năm ${last.year}; ${values.length} năm cùng số cổ phiếu, giá unadjusted đã chốt. Chỉ là bội số mô tả lịch sử, không phải backtest tại thời điểm chưa công bố EPS.`,
  };
}
export function sellAlerts(
  bars: PlanBar[],
  price: number | null,
  intrinsic: number | null,
): PlanAlert[] {
  const peaks = pivots(bars, 'high').filter((p) => p.index >= bars.length - 90);
  const second = peaks.at(-1),
    first = second
      ? [...peaks].reverse().find((p) => p.index <= second.index - 5)
      : undefined;
  const divergence = (indicator: 'rsi' | 'macd'): PlanAlert => {
    const label =
      indicator === 'rsi' ? 'Phân kỳ giảm RSI' : 'Phân kỳ giảm MACD';
    if (!first || !second)
      return {
        id: indicator,
        label,
        status: 'unknown',
        reason: 'Chưa đủ hai đỉnh được xác nhận, cách nhau ít nhất 5 phiên.',
      };
    const values = [first, second].map((p) => {
      const closes = bars.slice(0, p.index + 1).map((b) => b.closeVnd);
      if (indicator === 'rsi') {
        const r = rsi(closes);
        return r.ok ? r.value : null;
      }
      const m = macd(closes);
      return m.ok ? m.value.macd : null;
    });
    if (values.some((v) => v === null))
      return {
        id: indicator,
        label,
        status: 'unknown',
        reason: 'Chuỗi chỉ báo tại hai đỉnh chưa đủ nến.',
      };
    const triggered =
      second.price > first.price &&
      (indicator === 'rsi'
        ? values[1]! < values[0]! - 3
        : values[1]! < values[0]!);
    return {
      id: indicator,
      label,
      status: triggered ? 'triggered' : 'clear',
      reason: `Hai đỉnh ${first.date}/${second.date}: giá ${fmt(first.price)}→${fmt(second.price)} VND; ${indicator.toUpperCase()} ${fmt(values[0]!)}→${fmt(values[1]!)}. RSI cần giảm >3 điểm; MACD dùng đường MACD, không phải histogram.`,
    };
  };
  const recent = bars.slice(-5),
    baseline = bars.slice(-25, -5);
  const ratio =
    recent.length === 5 &&
    baseline.length === 20 &&
    mean(baseline.map((b) => b.volumeReported)) > 0
      ? mean(recent.map((b) => b.volumeReported)) /
        mean(baseline.map((b) => b.volumeReported))
      : null;
  return [
    {
      id: 'valuation',
      label: 'Định giá cao hơn giá trị nội tại',
      status:
        positive(price) && positive(intrinsic)
          ? price > intrinsic * 1.2
            ? 'triggered'
            : 'clear'
          : 'unknown',
      reason:
        positive(intrinsic) && positive(price)
          ? `Giá / Graham Number = ${fmt(price / intrinsic)}×; cảnh báo trên 1,2×. Graham theo dữ liệu nhà cung cấp, chưa thay cho định giá Buffett.`
          : 'Thiếu định giá hợp lệ hoặc giá hiện tại.',
    },
    divergence('rsi'),
    divergence('macd'),
    {
      id: 'liquidity',
      label: 'Thanh khoản cạn',
      status: ratio === null ? 'unknown' : ratio < 0.4 ? 'triggered' : 'clear',
      reason:
        ratio === null
          ? 'Cần 5 phiên gần nhất và 20 phiên nền có khối lượng dương.'
          : `KL trung bình 5 phiên / 20 phiên trước = ${fmt(ratio * 100)}%; cảnh báo dưới 40%.`,
    },
  ];
}
export function buildTradePlan(input: TradePlanInput) {
  const { settings: s, exchange, asOf } = input;
  if (!Number.isFinite(Date.parse(asOf)))
    throw new Error('Thời điểm tính vùng giá không hợp lệ.');
  if (!validTradeSettings(s)) throw new Error('Cài đặt vùng giá không hợp lệ.');
  const valid = validPlanBars(input.bars, input.symbol, asOf);
  const bars = valid ? input.bars : [];
  const recent = bars.slice(-120),
    closes = bars.map((b) => b.closeVnd),
    last = bars.at(-1);
  const stale =
    !last ||
    Date.parse(asOf) - Date.parse(last.sessionDate + 'T15:00:00+07:00') >
      7 * 86400000;
  const usable = stale ? [] : bars;

  const band = sessionBand(
    exchange,
    input.referenceVnd,
    input.floorVnd,
    input.ceilingVnd,
  );
  const level = (
    id: string,
    label: string,
    price: number | null,
    reason: string,
    rr: number | null = null,
  ): PlanLevel => ({
    id,
    label,
    price,
    reason,
    rr,
    band: price === null ? '—' : bandState(price, band),
  });
  const valuation = graham(input.financials, input.priceVnd, asOf).intrinsicVnd;
  const intrinsic = valuation.ok ? valuation.value : null;
  const ceiling =
    intrinsic === null ? null : intrinsic * (1 - s.marginOfSafety);
  const atrValue = atr(
    usable.map((b) => ({ high: b.highVnd, low: b.lowVnd, close: b.closeVnd })),
  );
  const ma = (p: number) =>
    usable.length >= p ? mean(closes.slice(-p)) : null;
  const lows = pivots(stale ? [] : recent, 'low'),
    highs = pivots(stale ? [] : recent, 'high');
  // Most recent confirmed upward swing: an earlier low followed by a confirmed high.
  const swingHigh = highs.at(-1),
    swingLow = swingHigh
      ? [...lows]
          .reverse()
          .find((p) => p.index < swingHigh.index && p.price < swingHigh.price)
      : undefined;
  const fib = fibonacci(swingLow?.price, swingHigh?.price),
    extension = fibonacciExtension(swingLow?.price, swingHigh?.price);
  const node = accumulationNode(usable);
  const supports = [
    ...lows.map((p) => ({ price: p.price, reason: `Đáy xác nhận ${p.date}` })),
    ...highs
      .filter(
        (p) =>
          usable.slice(-2).length === 2 &&
          usable.slice(-2).every((b) => b.closeVnd > p.price),
      )
      .map((p) => ({
        price: p.price,
        reason: `Đỉnh cũ ${p.date} chuyển thành hỗ trợ sau 2 nến cuối đóng cửa phía trên; chưa xác nhận retest`,
      })),
    ...([20, 50] as const).flatMap((p) => {
      const price = ma(p);
      return price === null ? [] : [{ price, reason: `MA${p} phiên ngày` }];
    }),
    ...(fib.ok
      ? Object.entries(fib.value).map(([r, price]) => ({
          price,
          reason: `Fibonacci retracement ${Number(r) * 100}% (${swingLow!.date}→${swingHigh!.date})`,
        }))
      : []),
    ...(node
      ? [
          {
            price: node.price,
            reason: `Nút khối lượng 60 phiên, ${fmt(node.share * 100)}% KL trong 1/12 khoảng giá; proxy theo giá đóng cửa, không xác nhận tích lũy tổ chức`,
          },
        ]
      : []),
  ];
  const market = positive(input.priceVnd)
    ? input.priceVnd
    : (last?.closeVnd ?? null);
  const support = supports
    .filter(
      (p) =>
        positive(market) &&
        p.price <= market * 1.02 &&
        (ceiling === null || p.price <= ceiling),
    )
    .sort((a, b) => b.price - a.price)[0];
  const width = support
    ? Math.max(
        tickSize(support.price, exchange),
        Math.min(
          support.price * 0.01,
          atrValue.ok ? atrValue.value * 0.25 : support.price * 0.01,
        ),
      )
    : 0;
  let buyLow = support
    ? roundPrice(support.price - width, exchange, 'up')
    : null;
  let buyHigh = support
    ? roundPrice(
        Math.min(support.price + width, ceiling ?? Infinity),
        exchange,
        'down',
      )
    : null;
  if (!positive(buyLow) || !positive(buyHigh) || buyLow > buyHigh) {
    buyLow = null;
    buyHigh = null;
  }
  const buyReason = support
    ? `${support.reason}. ${ceiling === null ? 'Chưa có biên an toàn định giá; chỉ là vùng kỹ thuật.' : `Trần mua = Graham Number × (1−${fmt(s.marginOfSafety * 100)}%) = ${fmt(ceiling)} VND.`}`
    : 'Chưa có hỗ trợ đủ dữ liệu nằm dưới trần mua định giá; không tạo vùng thay thế.';
  const entry =
    s.entryPriceVnd === null
      ? buyHigh
      : roundPrice(s.entryPriceVnd, exchange, 'up');
  const swingStop = lows.at(-1)?.price;
  const rawStop = positive(entry)
    ? s.stopMethod === 'percent'
      ? entry * (1 - s.maxLoss)
      : s.stopMethod === 'atr'
        ? atrValue.ok
          ? entry - s.atrMultiple * atrValue.value
          : null
        : swingStop === undefined
          ? null
          : swingStop - tickSize(swingStop, exchange)
    : null;
  const stopPrice =
    positive(entry) && rawStop !== null && Number.isFinite(rawStop)
      ? roundPrice(Math.max(rawStop, entry * (1 - s.maxLoss)), exchange, 'up')
      : null;
  const stop =
    positive(entry) && positive(stopPrice) && stopPrice < entry
      ? stopPrice
      : null;
  const stopReason = `${s.stopMethod === 'atr' ? `Giá vào − ${s.atrMultiple}×ATR14 (${atrValue.ok ? fmt(atrValue.value) : 'thiếu dữ liệu'})` : s.stopMethod === 'swing' ? 'Dưới đáy gần nhất đã xác nhận một bước giá' : `Giá vào × (1−${fmt(s.maxLoss * 100)}%)`}. Siết theo lỗ tối đa ${fmt(s.maxLoss * 100)}%; làm tròn lên để không nới rủi ro. ${stop === null ? 'Chưa đủ mức SL hợp lệ thấp hơn giá vào.' : ''}`;
  const pe = historicalPeTarget(input.financials, usable, asOf);
  const candidates = [
    ...(intrinsic === null
      ? []
      : [
          {
            price: intrinsic,
            reason:
              'Graham Number từ EPS năm/BVPS công ty mẹ; không dùng kịch bản DCF hợp nhất.',
          },
        ]),
    ...highs.map((p) => ({
      price: p.price,
      reason: `Kháng cự đỉnh cũ ${p.date}`,
    })),
    ...(extension.ok
      ? Object.entries(extension.value).map(([r, price]) => ({
          price,
          reason: `Fibonacci extension ${r} của nhịp ${swingLow!.date}→${swingHigh!.date}`,
        }))
      : []),
    ...(pe ? [pe] : []),
  ];
  const targets = candidates
    .map((c) => ({ ...c, price: roundPrice(c.price, exchange, 'down') }))
    .filter((c): c is { price: number; reason: string } => c.price !== null)
    .filter((c) => {
      const rr = riskReward(entry, stop, c.price);
      return rr !== null && rr >= 2;
    })
    .sort((a, b) => a.price - b.price)
    .filter((c, i, all) => i === 0 || c.price !== all[i - 1]!.price)
    .slice(0, 3);
  const positionDate =
    s.entryDate &&
    validSourceDate(s.entryDate) &&
    s.entryDate <= vietnamDate(Date.parse(asOf)) &&
    positive(s.entryPriceVnd)
      ? s.entryDate
      : null;
  const positionBars = positionDate
    ? usable.filter((b) => b.sessionDate > positionDate)
    : [];
  const highWater = positionDate
    ? Math.max(
        s.entryPriceVnd!,
        s.highWaterVnd ?? 0,
        ...positionBars.map((b) => b.highVnd),
      )
    : null;
  const trailing =
    positive(highWater) && s.trailing
      ? roundPrice(
          Math.max(
            highWater * (1 - s.trailingPercent),
            s.trailingStopVnd ?? 0,
            stop ?? 0,
          ),
          exchange,
          'up',
        )
      : null;
  const breached = positive(market) && positive(trailing) && market <= trailing;
  const levels = [
    level('buy-low', 'Vùng mua · dưới', buyLow, buyReason),
    level('buy-high', 'Vùng mua · trên', buyHigh, buyReason),
    level(
      'entry',
      'Giá vào kế hoạch',
      entry,
      s.entryPriceVnd === null
        ? 'Dùng mép trên vùng mua để tính R:R thận trọng.'
        : 'Giá do người dùng nhập, làm tròn lên bước giá để tính rủi ro thận trọng; không xác nhận đã khớp lệnh.',
    ),
    ...([0, 1, 2] as const).map((i) =>
      level(
        'tp' + (i + 1),
        'TP' + (i + 1),
        targets[i]?.price ?? null,
        targets[i]?.reason ??
          'Chưa có mục tiêu dựa trên dữ liệu đạt R:R ≥ 2 sau làm tròn; không tự nâng giá.',
        targets[i] ? riskReward(entry, stop, targets[i]!.price) : null,
      ),
    ),
    level('stop', 'Cắt lỗ kế hoạch', stop, stopReason),
    level(
      'trailing',
      'Trailing stop',
      trailing,
      positionDate
        ? `Đỉnh sau ngày vào ${positionDate} (bỏ high của ngày vào vì không biết giờ khớp): ${highWater === null ? '—' : fmt(highWater)} VND; trailing ${fmt(s.trailingPercent * 100)}%, chỉ tăng. ${breached ? 'Giá đã chạm/vượt xuống stop tham khảo; không giả định đã bán.' : ''}`
        : 'Cần giá vào và ngày mở vị thế để không dùng đỉnh trước khi mua.',
    ),
  ];
  return {
    status: 'scenario' as const,
    levels,
    alerts: sellAlerts(usable, input.priceVnd, intrinsic),
    highWaterVnd: highWater,
    trailingStopVnd: trailing,
    atrVnd: atrValue.ok ? atrValue.value : null,
    band,
    intrinsicVnd: intrinsic,
    historicalPe: pe,
    buyWithinSession:
      positive(buyLow) &&
      positive(buyHigh) &&
      band &&
      Math.max(buyLow, band.floor) <= Math.min(buyHigh, band.ceiling)
        ? {
            low: Math.max(buyLow, band.floor),
            high: Math.min(buyHigh, band.ceiling),
          }
        : null,
    notices: [
      ...(!valid
        ? [
            'Lịch sử sai mã, OHLC, thứ tự, basis hoặc nguồn: không tính kỹ thuật.',
          ]
        : []),
      ...(stale
        ? ['Lịch sử thiếu hoặc quá 7 ngày: không tính các mức kỹ thuật.']
        : []),
      'Nguồn hiện chưa xác minh điều chỉnh giá/chốt phiên; vùng và tín hiệu là kịch bản tham khảo, không đưa vào Top 10.',
      'P/E lịch sử cần ≥3 mốc cuối năm giá unadjusted đã chốt, EPS cùng năm và cùng số cổ phiếu; không đủ thì bỏ phương pháp này.',
      'R:R kế hoạch theo giá vào và SL trước trailing, chưa gồm phí, thuế hay trượt giá. Stop có thể không khớp khi giảm sàn hoặc mất thanh khoản.',
    ],
  };
}
export type TradePlan = ReturnType<typeof buildTradePlan>;
