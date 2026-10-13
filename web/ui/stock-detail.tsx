'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { stockDetail, type StockDetail as Detail } from '../lib/market-client';
import { changePercent } from '../../modules/market/chart';
import { PriceChart } from './price-chart';
import { ScoringPanel } from './scoring-panel';
export function StockDetail() {
  const params = useSearchParams();
  const symbol = (params.get('symbol') ?? 'VNM').trim().toUpperCase();
  return <DetailContent key={symbol} symbol={symbol} />;
}
function DetailContent({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return;
    }
    stockDetail(symbol, controller.signal)
      .then((d) => {
        if (controller.signal.aborted) return;
        setData(d);
        document.title = `${symbol} · ${d.stock.name} | VN Stock`;
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
      });
    return () => controller.abort();
  }, [symbol, refresh]);
  const money = (n: number | null | undefined) =>
    n == null
      ? 'Chưa có'
      : n.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
  function reload() {
    setData(null);
    setError('');
    setRefresh((v) => v + 1);
  }
  if (!/^[A-Z0-9]{3,12}$/.test(symbol))
    return <p role="alert">Mã chứng khoán không hợp lệ.</p>;
  if (error)
    return (
      <div className="empty-state" role="alert">
        <h1>{symbol}</h1>
        <p>{error}</p>
        <button onClick={reload}>Thử lại</button>
      </div>
    );
  if (!data)
    return (
      <div className="empty-state" aria-live="polite">
        Đang lấy dữ liệu thật cho {symbol}…
      </div>
    );
  const q = data.quote;
  const historyStamp = data.bars.at(-1)?.fetchedAt;
  const pct = q ? changePercent(q.lastPriceVnd, q.referenceVnd) : null;
  return (
    <>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            {data.stock.exchange} · CỔ PHIẾU VIỆT NAM
          </span>
          <h1>
            {symbol} <span>{data.stock.name}</span>
          </h1>
        </div>
        <button className="refresh-button" onClick={reload}>
          ↻ Cập nhật
        </button>
      </div>
      <div className="quote-summary">
        <div>
          <span>Giá hiện tại · VPS</span>
          <strong data-testid="current-price">
            {money(q?.lastPriceVnd)} <small>VND</small>
          </strong>
          <p
            className={pct !== null && pct >= 0 ? 'positive' : 'negative'}
            data-testid="price-change"
          >
            {pct === null
              ? 'Chưa có biến động'
              : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}{' '}
            <span>so với tham chiếu</span>
          </p>
        </div>
        <div className="quote-metrics">
          <div>
            <span>Tham chiếu</span>
            <strong>{money(q?.referenceVnd)}</strong>
          </div>
          <div>
            <span>Giá trần</span>
            <strong className="ceiling">{money(q?.ceilingVnd)}</strong>
          </div>
          <div>
            <span>Giá sàn</span>
            <strong className="floor">{money(q?.floorVnd)}</strong>
          </div>
          <div>
            <span>Tổng khối lượng</span>
            <strong>
              {money(q?.totalVolumeShares)} <small>CP</small>
            </strong>
          </div>
        </div>
      </div>
      <p className="data-timestamp">
        {q
          ? 'Nhận dữ liệu ' +
            new Intl.DateTimeFormat('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              dateStyle: 'short',
              timeStyle: 'medium',
            }).format(new Date(q.fetchedAt)) +
            ' (giờ Việt Nam); chưa có timestamp sàn.'
          : 'Không lấy được quote hiện tại.'}{' '}
        Lịch sử: {data.historySource} · {data.bars.length} phiên
        {historyStamp
          ? ' · nhận ' +
            new Intl.DateTimeFormat('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              dateStyle: 'short',
              timeStyle: 'medium',
            }).format(new Date(historyStamp))
          : ''}
        .
      </p>
      {data.notices.map((n) => (
        <p className="data-warning" key={n}>
          {n}
        </p>
      ))}
      <PriceChart bars={data.bars} />
      <ScoringPanel
        symbol={symbol}
        priceVnd={q?.lastPriceVnd ?? null}
        quoteFetchedAt={q?.fetchedAt ?? null}
      />
      <section className="overview-panel">
        <h2>Tổng quan</h2>
        <dl>
          <div>
            <dt>Công ty</dt>
            <dd>{data.stock.name}</dd>
          </div>
          <div>
            <dt>Sàn niêm yết</dt>
            <dd>{data.stock.exchange}</dd>
          </div>
          <div>
            <dt>Nguồn thông tin</dt>
            <dd>{data.stock.source}</dd>
          </div>
        </dl>
        <p>{data.notice}</p>
      </section>
    </>
  );
}
