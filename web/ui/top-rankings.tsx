'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchRankings,
  formatNumber,
  formatTime,
  horizonLabels,
  type RankingsResult,
} from '../lib/rankings';
import { priceChange, type Horizon } from '../../modules/scoring/rankings';
import { pollVisible } from '../lib/polling';
import { useLivePrices } from './use-live-prices';
import { AddWatchButton } from './add-watch-button';
const strategyLabels: Record<string, string> = {
  momentum: 'Động lượng',
  unusualVolume: 'Volume bất thường',
  shortTechnical: 'KT ngắn hạn',
  mediumTechnical: 'KT trung hạn',
  quality: 'Lọc cơ bản',
  graham: 'Graham',
  buffett: 'Buffett',
  valuation: 'Định giá',
  safety: 'Biên an toàn',
  events: 'Sự kiện',
  news: 'Tâm lý tin tức',
};
function RankingTable({
  horizon,
  exchange,
  sector,
  cap,
  onSectors,
  newsWeight,
}: {
  newsWeight: number;
  horizon: Horizon;
  exchange: string;
  sector: string;
  cap: string;
  onSectors: (sectors: string[]) => void;
}) {
  const [result, setResult] = useState<RankingsResult | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const live = useLivePrices(result?.data.map((row) => row.symbol) ?? []);
  useEffect(() => {
    let stopped = false,
      controller: AbortController | undefined;
    const update = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await fetchRankings(
          horizon,
          exchange,
          sector,
          cap,
          controller.signal,
          newsWeight,
        );
        if (stopped) return;
        setResult(data);
        onSectors(data.sectors);
        setError('');
      } catch (e) {
        if (!stopped && !controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
      } finally {
        if (!stopped) {
          setLoading(false);
        }
      }
    };
    const stop = pollVisible(update, 60000);
    return () => {
      stopped = true;
      controller?.abort();
      stop();
    };
  }, [horizon, exchange, sector, cap, onSectors, newsWeight]);
  return (
    <section className="ranking-section" data-testid={'ranking-' + horizon}>
      <div className="section-heading">
        <h2>Top 10 · {horizonLabels[horizon]}</h2>
        <span>
          {result?.run
            ? `Điểm tính lúc ${formatTime(result.run.computed_at)} · ${result.data.length}/10 mã đạt điều kiện`
            : 'Chưa có lượt chấm'}
        </span>
      </div>
      {error && (
        <p role="alert">
          {error}
          {result ? ' Đang hiển thị bản đã tải trước đó.' : ''}
        </p>
      )}
      {live.message && (
        <p className="data-timestamp" data-testid="ranking-live-status">
          {live.message} Điểm và thứ hạng có thời điểm tính riêng.
        </p>
      )}
      {loading && <p role="status">Đang tải dữ liệu…</p>}
      {result && result.data.length === 0 && (
        <p>
          Chưa có cổ phiếu đủ dữ liệu phù hợp bộ lọc này. Không dùng dữ liệu mẫu
          để lấp đầy.
        </p>
      )}
      {result && result.data.length > 0 && (
        <div className="table-scroll">
          <table className="ranking-table" data-testid="top10-table">
            <thead>
              <tr>
                <th>Hạng / mã</th>
                <th>Giá / thay đổi</th>
                <th>Điểm tổng</th>
                <th>Điểm chiến lược</th>
                <th>Lý do chính</th>
                <th>Theo dõi</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((stored) => {
                const q = live.prices[stored.symbol];
                const row = q
                  ? {
                      ...stored,
                      price_vnd: q.last_price_vnd,
                      reference_vnd: q.reference_vnd,
                      quote_fetched_at: q.fetched_at,
                    }
                  : stored;
                const change = priceChange(row.price_vnd, row.reference_vnd);
                return (
                  <tr key={row.stock_id}>
                    <td>
                      <strong>
                        {row.position}.{' '}
                        <Link href={'/stocks?symbol=' + row.symbol}>
                          {row.symbol}
                        </Link>
                      </strong>
                      <span>{row.name}</span>
                      <small>
                        {row.exchange} · {row.sector ?? 'Chưa có ngành'} ·{' '}
                        {formatNumber(
                          (row.explanation.marketCapVnd ?? 0) / 1e9,
                        )}{' '}
                        tỷ
                      </small>
                    </td>
                    <td>
                      <strong>
                        {formatNumber(row.price_vnd ?? row.reference_vnd)} đ
                      </strong>
                      <span
                        className={
                          change !== null && change >= 0
                            ? 'positive'
                            : 'negative'
                        }
                      >
                        {change !== null && change > 0 ? '+' : ''}
                        {formatNumber(change, 2)}%
                      </span>
                      {row.price_vnd === null && (
                        <small>
                          Giá tham chiếu; chưa có giá giao dịch cập nhật
                        </small>
                      )}
                      <small>
                        {q
                          ? 'VPS · phản hồi gần nhất'
                          : (row.explanation.quoteSource ??
                            'VPS · snapshot')}{' '}
                        · {formatTime(row.quote_fetched_at)}
                      </small>
                    </td>
                    <td>
                      <strong className="ranking-score">
                        {formatNumber(row.score, 1)}
                      </strong>
                      <small>
                        /100 · Bao phủ{' '}
                        {formatNumber(row.explanation.coverage * 100)}%
                      </small>
                      <small>Tin cậy {row.explanation.confidence}%</small>
                    </td>
                    <td>
                      <div className="strategy-chips">
                        {Object.entries(row.explanation.strategies)
                          .filter(
                            ([key]) =>
                              key === 'news' ||
                              (horizon === 'day'
                                ? [
                                    'momentum',
                                    'unusualVolume',
                                    'shortTechnical',
                                    'quality',
                                  ].includes(key)
                                : horizon === 'month'
                                  ? [
                                      'mediumTechnical',
                                      'valuation',
                                      'events',
                                    ].includes(key)
                                  : ['graham', 'buffett', 'safety'].includes(
                                      key,
                                    )),
                          )
                          .map(([key, value]) => (
                            <span key={key}>
                              {strategyLabels[key]}:{' '}
                              {value === null
                                ? 'không đủ dữ liệu'
                                : formatNumber(value, 1)}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td>
                      {row.explanation.newsIntegration?.news.links
                        .slice(0, 3)
                        .map((link) => (
                          <p key={link.url}>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Nguồn tin: {link.title}
                            </a>
                          </p>
                        ))}
                      {row.explanation.reasons.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                    </td>
                    <td>
                      <AddWatchButton
                        stockId={row.stock_id}
                        symbol={row.symbol}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {result && result.data.length > 0 && result.data.length < 10 && (
        <p>
          Chỉ có {result.data.length} mã đủ điều kiện; bảng không bổ sung mã
          thiếu dữ liệu.
        </p>
      )}
    </section>
  );
}
export function TopRankings() {
  const [newsWeight, setNewsWeight] = useState(0.1);
  const [horizon, setHorizon] = useState<Horizon>('day');
  const [exchange, setExchange] = useState(''),
    [sector, setSector] = useState(''),
    [cap, setCap] = useState(''),
    [sectors, setSectors] = useState<string[]>([]);
  const [onSectors] = useState(
    () => (values: string[]) =>
      setSectors((previous) =>
        previous.join('|') === values.join('|') ? previous : values,
      ),
  );
  return (
    <div className="phase4-page">
      <span className="eyebrow">SÀNG LỌC CỔ PHIẾU VIỆT NAM</span>
      <h1>Ba góc nhìn. Top 10 cổ phiếu.</h1>
      <p>
        <Link href="/backtest">Lịch sử &amp; backtest các lần công bố ↗</Link>
      </p>
      <p>
        Chỉ xếp hạng khi đủ 100% đầu vào của kỳ, tiêu chí tài chính bắt buộc và
        giá giao dịch có bằng chứng thời điểm nguồn. Mã chưa đủ thông tin được
        loại khỏi bảng; mỗi kỳ hiển thị tối đa 10 mã, không lấp đủ bằng mã thiếu
        dữ liệu. Giá tự lấy mỗi 10 giây khi mở trang; bảng điểm kiểm tra lại mỗi
        phút và ghi rõ thời điểm tính.
      </p>
      <div className="ranking-filters">
        <label>
          Kỳ xếp hạng
          <select
            aria-label="Kỳ xếp hạng"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
          >
            {(['day', 'month', 'quarter'] as const).map((h) => (
              <option key={h} value={h}>
                {horizonLabels[h]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trọng số tâm lý tin tức (%)
          <input
            aria-label="Trọng số tâm lý tin tức (%)"
            type="number"
            min="0"
            max="30"
            step="1"
            value={Math.round(newsWeight * 100)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (
                e.target.value !== '' &&
                Number.isFinite(n) &&
                n >= 0 &&
                n <= 30
              )
                setNewsWeight(n / 100);
            }}
          />
          <small>
            0%: tắt thành phần tin; mặc định 10%. Thiếu tin không quy về trung
            lập. Trọng số cơ sở giảm tương ứng.
          </small>
        </label>
        <label>
          Sàn
          <select
            aria-label="Sàn"
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
          >
            <option value="">Tất cả sàn</option>
            {['HOSE', 'HNX', 'UPCOM'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Ngành
          <select
            aria-label="Ngành"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          >
            <option value="">Tất cả ngành</option>
            {sectors.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {!sectors.length && <small>Chưa có phân ngành có nguồn.</small>}
        </label>
        <label>
          Vốn hóa
          <select
            aria-label="Vốn hóa"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          >
            <option value="">Tất cả vốn hóa</option>
            <option value="small">Dưới 1.000 tỷ</option>
            <option value="mid">1.000–10.000 tỷ</option>
            <option value="large">Từ 10.000 tỷ</option>
          </select>
        </label>
      </div>
      <RankingTable
        key={horizon + exchange + sector + cap + newsWeight}
        newsWeight={newsWeight}
        horizon={horizon}
        exchange={exchange}
        sector={sector}
        cap={cap}
        onSectors={onSectors}
      />
    </div>
  );
}
