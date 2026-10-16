'use client';
import { pollVisible } from '../lib/polling';
import Link from 'next/link';
import { StockNews } from './stock-news';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  stockDetail,
  cachedStockDetail,
  type StockDetail as Detail,
} from '../lib/market-client';
import { changePercent } from '../../modules/market/chart';
const TradeWorkbench = dynamic(
  () => import('./trade-workbench').then((m) => m.TradeWorkbench),
  { loading: () => <p role="status">Đang mở biểu đồ…</p> },
);
import type { FinancialData } from '../../modules/providers/financial-types';
import { ScoringPanel } from './scoring-panel';
export function StockDetail() {
  const params = useSearchParams();
  const symbol = (params.get('symbol') ?? 'VNM').trim().toUpperCase();
  return <DetailContent key={symbol} symbol={symbol} />;
}
function DetailContent({ symbol }: { symbol: string }) {
  const [financials, setFinancials] = useState<FinancialData | null>(null);
  const [data, setData] = useState<Detail | null>(() =>
    cachedStockDetail(symbol),
  );
  const [chart, setChart] = useState(() => {
    try {
      return (
        typeof window !== 'undefined' &&
        localStorage.getItem('vn-stock-auto-chart') === 'true'
      );
    } catch {
      return false;
    }
  });
  const [history, setHistory] = useState<Detail | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return;
    }
    const load = (fresh = false) => {
      return stockDetail(symbol, controller.signal, 'summary', fresh)
        .then((d) => {
          if (controller.signal.aborted) return;
          setData(d);
          setError('');
          document.title = `${symbol} · ${d.stock.name} | VN Stock`;
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(
              e instanceof Error ? e.message : 'Không tải được dữ liệu.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setUpdating(false);
        });
    };
    let initial = true;
    const stop = pollVisible(async () => {
      const fresh = initial && refresh > 0;
      initial = false;
      await load(fresh);
    });
    return () => {
      controller.abort();
      stop();
    };
  }, [symbol, refresh]);
  useEffect(() => {
    if (!chart) return;
    const controller = new AbortController();
    const loadHistory = () =>
      stockDetail(symbol, controller.signal, 'history')
        .then((h) => {
          if (!controller.signal.aborted) {
            setHistory(h);
            setHistoryError('');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setHistoryError(
              'Không tải được lịch sử. Tắt rồi bật lại để thử lại.',
            );
        });
    void loadHistory();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadHistory();
    }, 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [symbol, chart, refresh]);
  const money = (n: number | null | undefined) =>
    n == null ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
  function reload() {
    setUpdating(true);
    setError('');
    setRefresh((v) => v + 1);
  }
  if (!/^[A-Z0-9]{3,12}$/.test(symbol))
    return <p role="alert">Mã chứng khoán không hợp lệ.</p>;
  if (error && !data)
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
  const shown = data.displayPrice;
  const historyStamp = history?.bars.at(-1)?.fetchedAt;
  const pct =
    shown?.kind === 'close'
      ? null
      : q
        ? changePercent(q.lastPriceVnd, q.referenceVnd)
        : null;
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
        <button className="refresh-button" onClick={reload} disabled={updating}>
          {updating ? '↻ Đang cập nhật…' : '↻ Cập nhật'}
        </button>
      </div>
      <p>
        <Link className="paper-detail-link" href={'/paper?symbol=' + symbol}>
          Thử đầu tư {symbol} bằng vốn ảo ↗
        </Link>
      </p>
      <div className="quote-summary">
        <div>
          <span data-testid="display-price-label">
            {shown?.kind === 'close'
              ? `Đóng cửa phiên ${shown.sessionDate} · ${shown.source}`
              : 'Giá VPS gần nhất'}
          </span>
          <strong data-testid="current-price">
            {shown?.kind === 'unavailable' ? (
              'Đang đồng bộ giá…'
            ) : (
              <>
                {money(shown?.valueVnd ?? q?.lastPriceVnd)} <small>VND</small>
              </>
            )}
          </strong>
          <p
            className={
              pct === null ? 'neutral' : pct >= 0 ? 'positive' : 'negative'
            }
            data-testid="price-change"
          >
            {pct === null
              ? shown?.kind === 'close'
                ? 'Giá đóng cửa dự phòng · không phải giá khớp lệnh hiện tại'
                : 'Chưa có biến động'
              : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}{' '}
            {pct !== null && <span>so với tham chiếu</span>}
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
            ' (giờ Việt Nam); chưa có timestamp sàn. Tự kiểm tra mỗi 10 giây khi trang đang mở.'
          : 'Không lấy được quote hiện tại.'}{' '}
        {history
          ? `Lịch sử: ${history.historySource} · ${history.bars.length} phiên`
          : 'Biểu đồ chỉ tải khi bạn bật.'}
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
      {error && <p role="status">{error} Đang giữ dữ liệu đã tải.</p>}
      <section className="chart-preference">
        <div>
          <h2>Biểu đồ & vùng giá</h2>
          <p>
            Bật khi cần xem nến, MA và kế hoạch giao dịch. Lựa chọn được ghi nhớ
            trên thiết bị này.
          </p>
        </div>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={chart}
            onChange={(e) => {
              setChart(e.target.checked);
              try {
                localStorage.setItem(
                  'vn-stock-auto-chart',
                  String(e.target.checked),
                );
              } catch {
                /* Device storage optional. */
              }
            }}
          />
          Tự động tải biểu đồ nến
        </label>
      </section>
      {chart &&
        (history ? (
          <TradeWorkbench
            detail={{ ...data, bars: history.bars }}
            financials={financials}
          />
        ) : (
          <p role="status">{historyError || 'Đang tải lịch sử biểu đồ…'}</p>
        ))}
      <StockNews symbol={symbol} />
      <ScoringPanel
        symbol={symbol}
        onFinancials={setFinancials}
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
