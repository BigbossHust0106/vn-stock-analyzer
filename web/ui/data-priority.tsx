'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { searchStocks, type MarketStock } from '../lib/market-client';
export function DataPriority() {
  const [rows, setRows] = useState<MarketStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    void searchStocks('', '', c.signal)
      .then(setRows)
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            'Chưa tải được danh sách dữ liệu. Bạn có thể tìm mã trên thanh điều hướng.',
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, []);
  return (
    <section data-testid="data-priority">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">ƯU TIÊN ĐỘ ĐẦY ĐỦ</span>
          <h2>Các mã có nhiều dữ liệu để đánh giá</h2>
        </div>
      </div>
      <p>
        Ưu tiên tỷ lệ tiêu chí có dữ liệu của cả Graham và Buffett, sau đó kỳ
        báo cáo mới và số năm. Đây là danh sách để tra cứu, không phải xếp hạng
        nên mua.
      </p>
      {loading && <p role="status">Đang kiểm tra độ đầy đủ dữ liệu…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="data-priority-grid">
        {rows
          .filter((s) => (s.annual_years ?? 0) > 0)
          .slice(0, 12)
          .map((s) => (
            <Link
              className="data-priority-card"
              href={'/stocks?symbol=' + s.symbol}
              key={s.symbol}
            >
              <h3>
                {s.symbol} <small>{s.exchange}</small>
              </h3>
              <span>{s.name}</span>
              <p>
                Graham {Math.round((s.graham_coverage ?? 0) * 100)}% · Buffett{' '}
                {Math.round((s.buffett_coverage ?? 0) * 100)}% tiêu chí có dữ
                liệu
              </p>
              <progress
                value={s.coverage ?? 0}
                max={1}
                aria-label={'Độ đầy đủ dữ liệu ' + s.symbol}
              />
              <p>
                {s.annual_years} kỳ năm · mới nhất {s.latest_year ?? '—'} · Chưa
                chứng nhận toàn bộ bằng chứng giá/định giá.
              </p>
            </Link>
          ))}
      </div>
      {!loading && !error && !rows.some((s) => (s.annual_years ?? 0) > 0) && (
        <p>
          Chưa có snapshot BCTC đủ để ưu tiên. Tìm một mã trên thanh điều hướng
          để kiểm tra nguồn.
        </p>
      )}
    </section>
  );
}
