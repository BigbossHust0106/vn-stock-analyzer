'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { catalogStocks, type CatalogPage } from '../lib/market-client';
export function DataPriority() {
  const [data, setData] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [exchange, setExchange] = useState('');
  const [financials, setFinancials] = useState('available');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      void catalogStocks(query, exchange, financials, page, c.signal)
        .then((d) => {
          if (!c.signal.aborted) setData(d);
        })
        .catch(() => {
          if (!c.signal.aborted)
            setError(
              'Không tải được danh mục. Thử cập nhật lại; không coi đây là toàn bộ thị trường.',
            );
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, exchange, financials, page, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((v) => v + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  function change(action: () => void) {
    setData(null);
    setLoading(true);
    setPage(1);
    action();
  }
  const format = (n: number) => n.toLocaleString('vi-VN');
  return (
    <section data-testid="data-priority">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">DANH MỤC & ĐỘ PHỦ DỮ LIỆU</span>
          <h2>Tra cứu toàn bộ mã chứng khoán</h2>
        </div>
        <button
          type="button"
          onClick={() => setRefresh((v) => v + 1)}
          disabled={loading}
        >
          ↻ Cập nhật danh mục
        </button>
      </div>
      <p>
        Duyệt đầy đủ danh mục theo trang. Mặc định xem các mã đã có số liệu BCTC
        năm; chọn “Toàn bộ mã” để tra cứu cả danh mục. Danh sách theo thứ tự mã,
        không phải xếp hạng nên mua.
      </p>
      {data && (
        <p className="catalog-counts" data-testid="catalog-counts">
          <b>{format(data.counts.catalog)} mã trong danh mục</b> ·{' '}
          {format(data.counts.withAnnual)} mã có BCTC năm ·{' '}
          {format(data.counts.withoutSnapshot)} mã chưa thu thập BCTC ·{' '}
          {format(data.counts.otherSnapshots)} mã có snapshot nhưng chưa có kỳ
          năm chuẩn hóa. Số đếm toàn danh mục nguồn, không phải số kết quả bộ
          lọc.
        </p>
      )}
      <div className="catalog-filters">
        <label>
          Tìm trong danh mục
          <input
            aria-label="Tìm trong danh mục"
            value={query}
            maxLength={80}
            placeholder="Mã hoặc tên công ty"
            onChange={(e) => change(() => setQuery(e.target.value))}
          />
        </label>
        <label>
          Sàn
          <select
            aria-label="Sàn"
            value={exchange}
            onChange={(e) => change(() => setExchange(e.target.value))}
          >
            <option value="">Tất cả các sàn</option>
            {['HOSE', 'HNX', 'UPCOM'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Dữ liệu BCTC
          <select
            aria-label="Dữ liệu BCTC"
            value={financials}
            onChange={(e) => change(() => setFinancials(e.target.value))}
          >
            <option value="available">Đã có BCTC năm</option>
            <option value="all">Toàn bộ mã</option>
            <option value="missing">Chưa thu thập BCTC</option>
          </select>
        </label>
      </div>
      {loading && <p role="status">Đang tải danh mục…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">
            {format(data.total)} kết quả · Trang {page}/
            {Math.max(1, Math.ceil(data.total / data.pageSize))}. Kiểm tra lại
            mỗi phút khi trang đang mở; thời điểm nhận không chứng nhận dữ liệu
            nguồn.
          </p>
          <div className="data-priority-grid" aria-busy={loading}>
            {data.data.map((s) => (
              <Link
                className="data-priority-card"
                href={'/stocks?symbol=' + s.symbol}
                key={s.symbol}
              >
                <h3>
                  {s.symbol} <small>{s.exchange}</small>
                </h3>
                <span>{s.name}</span>
                {s.financial_state === 'available' ? (
                  <>
                    <p>
                      Graham {Math.round((s.graham_coverage ?? 0) * 100)}% ·
                      Buffett {Math.round((s.buffett_coverage ?? 0) * 100)}%
                      tiêu chí có dữ liệu
                    </p>
                    <progress
                      value={s.coverage ?? 0}
                      max={1}
                      aria-label={'Độ đầy đủ dữ liệu ' + s.symbol}
                    />
                    <p>
                      {s.annual_years} kỳ năm · mới nhất {s.latest_year ?? '—'}{' '}
                      · Chưa chứng nhận toàn bộ bằng chứng giá/định giá.
                    </p>
                  </>
                ) : (
                  <p>
                    {s.financial_state === 'missing'
                      ? 'Chưa thu thập BCTC. Có thể mở mã để thử tải nguồn; không đồng nghĩa doanh nghiệp kém chất lượng.'
                      : s.financial_state === 'unsupported'
                        ? 'Nhóm doanh nghiệp này chưa được mô hình Graham/Buffett hiện tại chuẩn hóa; không tự áp công thức sai nhóm.'
                        : 'Chưa có số liệu năm hợp lệ; không tự điền hoặc tạo điểm.'}
                  </p>
                )}
                {s.financial_fetched_at && (
                  <small>
                    Nhận BCTC:{' '}
                    {new Date(s.financial_fetched_at).toLocaleString('vi-VN', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                    })}{' '}
                    (giờ Việt Nam)
                  </small>
                )}
              </Link>
            ))}
          </div>
          {!data.data.length && (
            <p>
              Không có kết quả phù hợp. Thử chọn “Toàn bộ mã” hoặc đổi bộ lọc.
            </p>
          )}
          <nav className="catalog-pagination" aria-label="Phân trang danh mục">
            <button
              type="button"
              disabled={loading || page === 1}
              onClick={() => {
                setData(null);
                setLoading(true);
                setPage((p) => p - 1);
              }}
            >
              ← Trang trước
            </button>
            <span>Trang {page}</span>
            <button
              type="button"
              disabled={loading || page * data.pageSize >= data.total}
              onClick={() => {
                setData(null);
                setLoading(true);
                setPage((p) => p + 1);
              }}
            >
              Trang sau →
            </button>
          </nav>
        </>
      )}
      <p className="data-timestamp">
        Hàng đồng bộ BCTC tự duyệt toàn bộ mã đang hoạt động, mỗi lượt tối đa
        một mã để giới hạn tải nguồn. Nguồn thiếu hoặc lỗi được giữ nguyên trạng
        thái; chưa cam kết mọi mã đều có BCTC dùng được.
      </p>
    </section>
  );
}
