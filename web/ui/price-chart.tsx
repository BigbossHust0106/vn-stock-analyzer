'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type Time,
} from 'lightweight-charts';
import {
  aggregateBars,
  movingAverage,
  type ChartFrame,
} from '../../modules/market/chart';
import type { PlanLevel } from '../../modules/trading/trade-plan';
import { priceZones } from './price-zones';
import type { DailyBar } from '../../modules/providers/data-provider';
const emptyLevels: PlanLevel[] = [];
export function PriceChart({
  bars,
  levels = emptyLevels,
}: {
  bars: DailyBar[];
  levels?: PlanLevel[];
}) {
  const target = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<ChartFrame>('day');
  const [range, setRange] = useState(365);
  const data = useMemo(() => aggregateBars(bars, frame), [bars, frame]);
  const [hover, setHover] = useState(
    'Di chuột lên biểu đồ để xem OHLC và khối lượng',
  );
  useEffect(() => {
    if (!target.current || !bars.length) return;
    const colors = () => getComputedStyle(document.documentElement);
    const styles = colors();
    const chart = createChart(target.current, {
      autoSize: true,
      height: 440,
      layout: {
        background: {
          type: ColorType.Solid,
          color: styles.getPropertyValue('--panel').trim(),
        },
        textColor: styles.getPropertyValue('--muted').trim(),
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: styles.getPropertyValue('--border').trim() },
        horzLines: { color: styles.getPropertyValue('--border').trim() },
      },
      localization: {
        locale: 'vi-VN',
        priceFormatter: (n: number) => new Intl.NumberFormat('vi-VN').format(n),
      },
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.28 } },
      timeScale: { timeVisible: false },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#16b68c',
      downColor: '#f05c75',
      borderVisible: false,
      wickUpColor: '#16b68c',
      wickDownColor: '#f05c75',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });
    candles.setData(
      data.map((b) => ({
        time: b.sessionDate as Time,
        open: b.openVnd,
        high: b.highVnd,
        low: b.lowVnd,
        close: b.closeVnd,
      })),
    );
    for (const level of levels) {
      if (level.price === null) continue;
      const color = level.id.startsWith('buy')
        ? '#16b68c'
        : level.id === 'stop'
          ? '#f05c75'
          : level.id === 'trailing'
            ? '#e6a93c'
            : level.id.startsWith('tp')
              ? '#729bff'
              : '#8b9fad';
      candles.createPriceLine({
        price: level.price,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title:
          level.id === 'stop'
            ? 'SL'
            : level.id === 'trailing'
              ? 'Trail'
              : level.id.startsWith('tp')
                ? level.id.toUpperCase()
                : level.id === 'entry'
                  ? 'Vào'
                  : level.id === 'buy-low'
                    ? 'Mua ↓'
                    : 'Mua ↑',
      });
    }
    candles.attachPrimitive(priceZones(candles, levels));
    const volume = chart.addSeries(HistogramSeries, {
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(
      data.map((b) => ({
        time: b.sessionDate as Time,
        value: b.volumeReported,
        color: b.closeVnd >= b.openVnd ? '#16b68c70' : '#f05c7570',
      })),
    );
    for (const [period, color] of [
      [20, '#f3bd4c'],
      [50, '#8a99ff'],
      [200, '#e791c7'],
    ] as const) {
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        title: 'MA' + period,
      });
      line.setData(movingAverage(data, period));
    }
    const last = data.at(-1)!;
    const start = new Date(last.sessionDate + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - range);
    const first =
      start.toISOString().slice(0, 10) > data[0]!.sessionDate
        ? start.toISOString().slice(0, 10)
        : data[0]!.sessionDate;
    chart.timeScale().setVisibleRange({ from: first, to: last.sessionDate });
    chart.subscribeCrosshairMove((param) => {
      const value = param.seriesData.get(candles);
      const v = param.seriesData.get(volume);
      if (value && 'open' in value)
        setHover(
          `O ${value.open.toLocaleString('vi-VN')} · H ${value.high.toLocaleString('vi-VN')} · L ${value.low.toLocaleString('vi-VN')} · C ${value.close.toLocaleString('vi-VN')} VND${v && 'value' in v ? ' · KL ' + v.value.toLocaleString('vi-VN') : ''}`,
        );
    });
    const observer = new MutationObserver(() => {
      const s = colors();
      chart.applyOptions({
        layout: {
          background: {
            type: ColorType.Solid,
            color: s.getPropertyValue('--panel').trim(),
          },
          textColor: s.getPropertyValue('--muted').trim(),
        },
        grid: {
          vertLines: { color: s.getPropertyValue('--border').trim() },
          horzLines: { color: s.getPropertyValue('--border').trim() },
        },
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [bars, data, range, levels]);
  return (
    <section className="chart-panel">
      <div className="chart-heading">
        <h2>
          Diễn biến giá <span>VND</span>
        </h2>
        <div className="chart-controls">
          {(['day', 'week', 'month'] as const).map((f, i) => (
            <button
              key={f}
              aria-pressed={frame === f}
              onClick={() => setFrame(f)}
            >
              {['Ngày', 'Tuần', 'Tháng'][i]}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-tools">
        <div className="ma-legend">
          {[20, 50, 200].map((period) => (
            <span key={period}>
              ● MA{period}{' '}
              <b data-testid={`ma-${period}`}>
                {movingAverage(data, period)
                  .at(-1)
                  ?.value.toLocaleString('vi-VN', {
                    maximumFractionDigits: 2,
                  }) ?? 'chưa đủ nến'}
              </b>
            </span>
          ))}
        </div>
        <div className="chart-controls">
          {[
            [30, '1T'],
            [90, '3T'],
            [180, '6T'],
            [365, '1N'],
            [1096, '3N'],
          ].map(([days, label]) => (
            <button
              key={days}
              aria-pressed={range === days}
              onClick={() => setRange(Number(days))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="chart-readout">{hover}</p>
      <p>
        Phiên biểu đồ gần nhất {data.at(-1)?.sessionDate ?? '—'} · Khối lượng{' '}
        <b data-testid="chart-last-volume">
          {data.at(-1)?.volumeReported.toLocaleString('vi-VN') ?? '—'}
        </b>{' '}
        CP · Chưa xác minh trạng thái chốt của nguồn.
      </p>
      {bars.length ? (
        <div ref={target} data-testid="price-chart" className="chart-canvas" />
      ) : (
        <p className="empty-state">
          Chưa có lịch sử giá; không tạo dữ liệu thay thế.
        </p>
      )}
      {levels.length > 0 && (
        <div className="chart-level-legend" data-testid="chart-plan-levels">
          {levels
            .filter((l) => l.price !== null)
            .map((l) => (
              <span key={l.id} data-level={l.id}>
                {l.label}: <b>{l.price!.toLocaleString('vi-VN')}</b>
              </span>
            ))}
          <small>Đường nét đứt và vùng tô màu: kịch bản tham khảo.</small>
        </div>
      )}
      <p className="chart-footnote">
        MA dùng{' '}
        {frame === 'day'
          ? 'phiên ngày'
          : frame === 'week'
            ? 'nến tuần'
            : 'nến tháng'}
        ; cần đủ 20 / 50 / 200 nến. Khối lượng: cổ phiếu. Basis điều chỉnh chưa
        xác minh.{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Biểu đồ sử dụng TradingView Lightweight Charts™
        </a>
        .
      </p>
    </section>
  );
}
