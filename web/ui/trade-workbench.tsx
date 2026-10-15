'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { StockDetail } from '../lib/market-client';
import type { FinancialData } from '../../modules/providers/financial-types';
import { useAuth } from './auth-provider';
import { useTradeSettings } from '../lib/trade-plan-settings';
import { buildTradePlan } from '../../modules/trading/trade-plan';
import type { TradePlanSettings } from '../../modules/settings/trade-plan-settings';
import { defaultTradeSettings } from '../../modules/settings/trade-plan-settings';
import { formatNumber } from '../lib/rankings';
import { vietnamDate } from '../../modules/market/calendar';
import { PriceChart } from './price-chart';
export function TradeWorkbench({
  detail,
  financials,
}: {
  detail: StockDetail;
  financials: FinancialData | null;
}) {
  const { user } = useAuth();
  const { value: settings, save } = useTradeSettings(
    user?.id ?? 'pending',
    detail.stock.symbol,
  );
  const [message, setMessage] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(
      () => setAsOf(new Date().toISOString()),
      60000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const plan = useMemo(
    () =>
      buildTradePlan({
        symbol: detail.stock.symbol,
        exchange: detail.stock.exchange,
        bars: detail.bars,
        financials,
        priceVnd: detail.quote?.lastPriceVnd ?? null,
        referenceVnd: detail.quote?.referenceVnd ?? null,
        floorVnd: detail.quote?.floorVnd ?? null,
        ceilingVnd: detail.quote?.ceilingVnd ?? null,
        settings,
        asOf,
      }),
    [detail, financials, settings, asOf],
  );
  useEffect(() => {
    if (
      settings.trailing &&
      plan.highWaterVnd !== null &&
      plan.trailingStopVnd !== null &&
      (plan.highWaterVnd! > (settings.highWaterVnd ?? 0) ||
        plan.trailingStopVnd! > (settings.trailingStopVnd ?? 0))
    )
      save({
        ...settings,
        highWaterVnd: plan.highWaterVnd,
        trailingStopVnd: plan.trailingStopVnd,
      });
  }, [settings, plan.highWaterVnd, plan.trailingStopVnd, save]);
  function update(patch: Partial<TradePlanSettings>) {
    const positionChanged = 'entryDate' in patch || 'entryPriceVnd' in patch;
    const next = {
      ...settings,
      ...patch,
      ...(positionChanged ? { highWaterVnd: null, trailingStopVnd: null } : {}),
    };
    setMessage(
      save(next)
        ? 'Đã lưu cài đặt vùng giá cho tài khoản và mã này trên trình duyệt.'
        : 'Không lưu được. Kiểm tra giới hạn số hoặc quyền lưu của trình duyệt.',
    );
  }
  const numeric = (
    label: string,
    key: 'marginOfSafety' | 'maxLoss' | 'atrMultiple' | 'trailingPercent',
    min: number,
    max: number,
    scale = 100,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={0.5}
        value={Number((settings[key] * scale).toFixed(2))}
        onChange={(e) => {
          if (e.currentTarget.value !== '')
            update({ [key]: Number(e.currentTarget.value) / scale });
        }}
      />
    </label>
  );
  return (
    <>
      <PriceChart
        bars={detail.bars}
        levels={settings.showLevels ? plan.levels : []}
      />
      <section className="trade-plan-panel" data-testid="trade-plan">
        <div className="detail-heading">
          <div>
            <span className="eyebrow">VÙNG GIÁ & QUẢN LÝ RỦI RO</span>
            <h2>Kế hoạch giao dịch · {detail.stock.symbol}</h2>
          </div>
          <span className="plan-status">Kịch bản tham khảo</span>
        </div>
        <p>
          Vùng mua, TP và stop là kết quả mô hình. Lịch sử chưa xác minh điều
          chỉnh giá/chốt phiên; không phải lệnh giao dịch hay vùng mua đã xác
          nhận.
        </p>
        <div className="trade-controls">
          {numeric('Biên an toàn mua (%)', 'marginOfSafety', 0, 70)}
          {numeric('Lỗ tối đa (%)', 'maxLoss', 0.5, 30)}
          <label>
            Phương pháp cắt lỗ
            <select
              aria-label="Phương pháp cắt lỗ"
              value={settings.stopMethod}
              onChange={(e) =>
                update({
                  stopMethod: e.target.value as TradePlanSettings['stopMethod'],
                })
              }
            >
              <option value="atr">ATR14</option>
              <option value="swing">Đáy gần nhất</option>
              <option value="percent">Phần trăm tối đa</option>
            </select>
          </label>
          {numeric('Hệ số ATR', 'atrMultiple', 0.5, 5, 1)}
          <label>
            Giá vào kế hoạch (VND)
            <input
              aria-label="Giá vào kế hoạch (VND)"
              type="number"
              min="1"
              max="1000000000000"
              placeholder="Mép trên vùng mua"
              value={settings.entryPriceVnd ?? ''}
              onChange={(e) =>
                update({
                  entryPriceVnd:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Ngày mở vị thế
            <input
              aria-label="Ngày mở vị thế"
              type="date"
              max={vietnamDate(Date.parse(asOf))}
              value={settings.entryDate ?? ''}
              onChange={(e) => update({ entryDate: e.target.value || null })}
            />
          </label>
          {numeric('Trailing stop (%)', 'trailingPercent', 0.5, 30)}
        </div>
        <div className="trade-toggles">
          <label>
            <input
              type="checkbox"
              checked={settings.showLevels}
              onChange={(e) => update({ showLevels: e.target.checked })}
            />{' '}
            Hiện vùng tham khảo trên biểu đồ
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.trailing}
              onChange={(e) => update({ trailing: e.target.checked })}
            />{' '}
            Bật trailing stop
          </label>
          <button
            onClick={() => {
              save({ ...defaultTradeSettings });
              setMessage(
                'Đã khôi phục cài đặt vùng giá; đã xóa trạng thái trailing của mã này.',
              );
            }}
          >
            Khôi phục vùng giá mặc định
          </button>
        </div>
        <p role="status">{message}</p>
        <p>
          ATR14:{' '}
          <b data-testid="plan-atr">{formatNumber(plan.atrVnd, 2)} VND</b> · R:R
          tối thiểu <b>2:1</b> · Biên độ:{' '}
          {plan.band
            ? `${formatNumber(plan.band.floor)}–${formatNumber(plan.band.ceiling)} VND`
            : 'chưa đủ dữ liệu'}
          .
        </p>
        <p className="data-timestamp">
          {plan.band?.source} Mức chiến lược ngoài biên độ không bị ép về
          trần/sàn; chưa thể đặt ở mức đó trong phiên này.
        </p>
        <div className="table-scroll">
          <table className="plan-table">
            <thead>
              <tr>
                <th>Mức</th>
                <th>Giá (VND)</th>
                <th>R:R kế hoạch</th>
                <th>Biên độ phiên</th>
                <th>Cơ sở tính</th>
              </tr>
            </thead>
            <tbody>
              {plan.levels.map((level) => (
                <tr
                  key={level.id}
                  data-testid={'plan-' + level.id}
                  data-price={level.price ?? ''}
                  data-rr={level.rr ?? ''}
                >
                  <th>{level.label}</th>
                  <td>
                    {level.price === null
                      ? 'Không đủ dữ liệu'
                      : formatNumber(level.price)}
                  </td>
                  <td>
                    {level.rr === null ? '—' : formatNumber(level.rr, 2) + ':1'}
                  </td>
                  <td>{level.band}</td>
                  <td>
                    {level.reason}
                    {level.price !== null &&
                      [
                        'buy-low',
                        'tp1',
                        'tp2',
                        'tp3',
                        'stop',
                        'trailing',
                      ].includes(level.id) && (
                        <p>
                          <Link
                            href={
                              '/alerts?symbol=' +
                              detail.stock.symbol +
                              '&kind=' +
                              (level.id === 'buy-low'
                                ? 'buy_zone'
                                : level.id.startsWith('tp')
                                  ? 'sell_zone'
                                  : 'stop_loss') +
                              '&lower=' +
                              level.price +
                              (level.id === 'buy-low'
                                ? '&upper=' +
                                  (plan.levels.find((l) => l.id === 'buy-high')
                                    ?.price ?? level.price)
                                : '')
                            }
                          >
                            Tạo cảnh báo mức này ↗
                          </Link>
                        </p>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Cảnh báo bán theo mô hình</h3>
        <div className="plan-alerts">
          {plan.alerts.map((alert) => (
            <article
              key={alert.id}
              data-testid={'sell-' + alert.id}
              data-status={alert.status}
            >
              <strong>{alert.label}</strong>
              <span
                className={
                  'criterion-status ' +
                  (alert.status === 'triggered'
                    ? 'fail'
                    : alert.status === 'clear'
                      ? 'pass'
                      : 'unknown')
                }
              >
                {alert.status === 'triggered'
                  ? 'Có cảnh báo'
                  : alert.status === 'clear'
                    ? 'Chưa phát hiện'
                    : 'Không đủ dữ liệu'}
              </span>
              <p>{alert.reason}</p>
            </article>
          ))}
        </div>
        <details>
          <summary>Giới hạn dữ liệu và phương pháp</summary>
          <ul>
            {plan.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p>
            {plan.historicalPe?.reason ??
              'P/E lịch sử của riêng mã: không đủ dữ liệu đúng basis và cùng kỳ; không dùng P/E của ngành để thay thế.'}
          </p>
        </details>
        <p>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</p>
      </section>
    </>
  );
}
