'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { holdings, type Holding } from '../../modules/backtest/returns';
import { vietnamDate } from '../../modules/market/calendar';
import {
  fetchBacktest,
  type BacktestResult,
  type PriceCheck,
} from '../lib/backtest';
import { formatTime, horizonLabels } from '../lib/rankings';
const labels = { day: '1 ngày', month: '1 tháng', quarter: '1 quý' };
const pct = (n: number | null | undefined) =>
  n === null || n === undefined
    ? 'Không đủ dữ liệu'
    : new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: 2,
        signDisplay: 'exceptZero',
      }).format(n) + '%';
export function BacktestDashboard() {
  const [horizon, setHorizon] = useState<Holding>('day'),
    [cursor, setCursor] = useState<{ before: string; id: string } | null>(null);
  const [data, setData] = useState<BacktestResult | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ horizon, ...(cursor ?? {}) });
    void fetchBacktest<BacktestResult>(query, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setData(r);
        setError('');
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            'Chưa tải được lịch sử. Thử lại hoặc xem Trạng thái hệ thống.',
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [horizon, cursor, retry]);
  function choose(next: Holding) {
    setHorizon(next);
    setCursor(null);
    setData(null);
    setLoading(true);
  }
  return (
    <div className="backtest-page">
      <section className="backtest-intro">
        <span className="eyebrow">KIỂM CHỨNG THEO THỜI GIAN</span>
        <h1>Lịch sử &amp; backtest Top 10</h1>
        <p>
          Quan sát kết quả của danh sách đã công bố, giữ nguyên mã và điểm tại
          thời điểm ghi nhận.
        </p>
        <Link href="/status">Xem chất lượng &amp; trạng thái dữ liệu ↗</Link>
      </section>
      <section className="backtest-method">
        <h2>Đọc kết quả đúng cách</h2>
        <p>
          Mô phỏng mua từ phiên kế tiếp, chia đều vốn. Thiếu giá hoặc chưa đủ kỳ
          quan sát thì chưa có kết quả; thiếu dữ liệu không phải lợi nhuận 0%.
        </p>
        <details>
          <summary>Quy tắc mô phỏng và giới hạn backtest</summary>
          <p>
            Mua bằng giá mở cửa phiên xác minh đầu tiên sau ngày ghi nhận (giờ
            Việt Nam). Kỳ 1 ngày bán ở đóng cửa phiên mua; kỳ tháng/quý bán ở
            đóng cửa phiên đầu tiên từ ngày đủ 1/3 tháng lịch. Nếu cuối tháng,
            dùng ngày cuối tháng tương ứng.
          </p>
          <p>
            Chia đều vốn ban đầu cho các mã trong danh sách, không tái cân bằng.
            Dùng giá điều chỉnh cùng nguồn; không khẳng định là tổng lợi nhuận
            tái đầu tư cổ tức. VN-Index dùng điểm mở/đóng trên đúng các phiên
            đó. Chưa trừ phí, thuế, trượt giá; chưa mô phỏng khối lượng khớp hay
            giá trần/sàn.
          </p>
          <p>
            <strong>Giới hạn:</strong> snapshot từ lúc tính năng bắt đầu, không
            dựng lại Top 10 quá khứ. Dữ liệu tài chính có thể đã công bố lại:
            vẫn có rủi ro look-ahead bias. Danh mục thu thập hiện tại có thể
            thiếu cổ phiếu đã hủy niêm yết: thiên lệch sống sót. Mã thiếu giá
            không được âm thầm loại khỏi mẫu. Các snapshot chồng lấn không phải
            các phép thử độc lập và không được ghép lãi kép.
          </p>
        </details>
      </section>
      <section className="backtest-history">
        <div className="backtest-toolbar">
          <h2>Danh sách đã ghi nhận</h2>
          <label>
            Bảng Top 10
            <select
              aria-label="Bảng Top 10"
              value={horizon}
              onChange={(e) => choose(e.target.value as Holding)}
            >
              {holdings.map((h) => (
                <option key={h} value={h}>
                  {horizonLabels[h]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setLoading(true);
              setRetry((n) => n + 1);
            }}
          >
            Làm mới backtest
          </button>
        </div>
        {loading && <p role="status">Đang tải lịch sử…</p>}
        {error && (
          <p role="alert">{error} Kết quả cũ không được coi là đã cập nhật.</p>
        )}
        {data && !loading && !error && (
          <>
            <p>
              Ghi nhận trên trang: {data.data.length} bản công bố · đọc lúc{' '}
              {formatTime(data.asOf)}. Lưu cả lượt chưa có mã đủ chuẩn; không
              điền mã thiếu bằng chứng cho đủ 10.
            </p>
            {data.data.length === 0 && (
              <p className="backtest-empty" data-testid="backtest-empty">
                Chưa có lịch sử công bố. Không đủ dữ liệu để tính backtest Top
                10.
              </p>
            )}
            {data.data.map((c) => (
              <article className="backtest-cohort" key={c.id}>
                <h3>{formatTime(c.recorded_at)}</h3>
                <p>
                  {c.items.length}/10 mã · {c.eligible_count} mã đủ chuẩn /{' '}
                  {c.universe_count} mã có đầu vào · điểm gốc tính lúc{' '}
                  {formatTime(c.source_run_at)}
                </p>
                <p>
                  Mô hình {c.model_version} · quy tắc {c.policy}. Trọng số cá
                  nhân hiện tại không sửa lịch sử này.
                </p>
                {c.items.length === 0 && (
                  <p className="backtest-empty">
                    Không có mã đạt chuẩn tại lần ghi nhận này. Không đủ dữ
                    liệu; không phải lợi nhuận 0%.
                  </p>
                )}
                <div className="backtest-table-scroll">
                  <table>
                    <caption>Kết quả từ bản công bố này</caption>
                    <thead>
                      <tr>
                        <th>Kỳ giữ</th>
                        <th>Mẫu có giá</th>
                        <th>Lợi nhuận giá</th>
                        <th>Tỷ lệ thắng</th>
                        <th>VN-Index</th>
                        <th>Chênh lệch (điểm %)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((h) => {
                        const r = c.results[h];
                        return (
                          <tr key={h}>
                            <th>{labels[h]}</th>
                            <td>
                              {r.measured}/{r.expected}
                            </td>
                            <td>{pct(r.returnPct)}</td>
                            <td>{pct(r.winRatePct)}</td>
                            <td>{pct(r.benchmarkPct)}</td>
                            <td>
                              {r.excessPct === null
                                ? 'Không đủ dữ liệu'
                                : new Intl.NumberFormat('vi-VN', {
                                    maximumFractionDigits: 2,
                                  }).format(r.excessPct)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {c.items.length > 0 && (
                  <details>
                    <summary>Mã, điểm và giá dùng để tính</summary>
                    {c.items.map((m) => (
                      <div className="backtest-member" key={m.stock_id}>
                        <Link href={'/stocks?symbol=' + m.symbol}>
                          {m.position}. {m.symbol} · {m.name}
                        </Link>
                        <p>
                          Điểm đã lưu:{' '}
                          {new Intl.NumberFormat('vi-VN', {
                            maximumFractionDigits: 3,
                          }).format(m.score)}
                        </p>
                        {holdings.map((h) => {
                          const o = c.results[h].observations.find(
                            (x) => x.symbol === m.symbol,
                          );
                          return (
                            <p key={h}>
                              {labels[h]}: {o?.entryDate ?? 'chưa có phiên'} →{' '}
                              {o?.exitDate ?? o?.targetDate ?? 'chưa đủ kỳ'} ·{' '}
                              {pct(o?.returnPct)} ·{' '}
                              {o?.reason ??
                                (o?.benchmarkPct === null
                                  ? 'Thiếu VN-Index cùng phiên.'
                                  : o?.source)}
                            </p>
                          );
                        })}
                      </div>
                    ))}
                  </details>
                )}
              </article>
            ))}
            <div className="backtest-pagination">
              <button
                disabled={!cursor}
                onClick={() => {
                  setCursor(null);
                  setLoading(true);
                }}
              >
                Về mới nhất
              </button>
              <button
                disabled={!data.next}
                onClick={() => {
                  setCursor(data.next);
                  setLoading(true);
                }}
              >
                Xem cũ hơn
              </button>
            </div>
          </>
        )}
      </section>
      <ReportedPriceCheck />
      <p>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</p>
    </div>
  );
}
function ReportedPriceCheck() {
  const [today] = useState(() => vietnamDate(Date.now()));
  const [earliest] = useState(() => vietnamDate(Date.now() - 1100 * 86400000));
  const [symbol, setSymbol] = useState('DPR'),
    [start, setStart] = useState(() =>
      vietnamDate(Date.now() - 365 * 86400000),
    ),
    [source, setSource] = useState('VPS'),
    [result, setResult] = useState<PriceCheck | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(
        await fetchBacktest<PriceCheck>(
          new URLSearchParams({ mode: 'prices', symbol, start, source }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đủ dữ liệu.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="backtest-diagnostic">
      <span className="eyebrow">ĐỐI CHIẾU DỮ LIỆU HIỆN CÓ</span>
      <h2>Kiểm tra biến động giá báo cáo</h2>
      <p>
        <strong>Không phải backtest Top 10.</strong> Không sử dụng điểm/xếp hạng
        quá khứ. Giá chưa xác minh adjusted/unadjusted, finality và lịch sàn;
        chia tách/cổ tức có thể làm sai biến động. Chỉ đọc lịch sử đã lưu, không
        tạo dữ liệu để lấp chỗ trống.
      </p>
      <form
        className="backtest-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label>
          Mã kiểm tra
          <input
            value={symbol}
            pattern="[A-Z0-9]{3,12}"
            required
            maxLength={12}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Ngày bắt đầu
          <input
            type="date"
            required
            min={earliest}
            max={today}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Nguồn giá
          <select
            aria-label="Nguồn giá"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option>VPS</option>
            <option>KBS</option>
          </select>
        </label>
        <button disabled={busy}>
          {busy ? 'Đang đối chiếu…' : 'Kiểm tra giá báo cáo'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div data-testid="reported-price-result">
          <p>
            {result.symbol} · {result.source} · {result.notice}
          </p>
          <div className="backtest-table-scroll">
            <table>
              <caption>
                Biến động trên bar báo cáo đầu tiên từ ngày chọn (tối đa lệch 7
                ngày)
              </caption>
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Biến động chưa xác minh</th>
                  <th>Bar mua → bar bán</th>
                  <th>Giá mở → đóng (VND)</th>
                  <th>VN-Index</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const l = result.legs[h];
                  return (
                    <tr key={h}>
                      <th>{labels[h]}</th>
                      <td>{pct(l.returnPct)}</td>
                      <td>
                        {l.entryDate ?? 'Không đủ dữ liệu'} →{' '}
                        {l.exitDate ?? 'chưa đủ kỳ'}
                      </td>
                      <td>
                        {l.entry?.toLocaleString('vi-VN') ?? '—'} →{' '}
                        {l.exit?.toLocaleString('vi-VN') ?? '—'}
                      </td>
                      <td>Không đủ dữ liệu</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Link href={'/stocks?symbol=' + result.symbol}>
            Đối chiếu biểu đồ {result.symbol} ↗
          </Link>
        </div>
      )}
    </section>
  );
}
