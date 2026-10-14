'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { scoreStock } from '../../modules/scoring/engine';
import {
  isFinancialData,
  type FinancialData,
} from '../../modules/providers/financial-types';
import { useScoringSettings } from '../lib/scoring-settings';
import { marketJson } from '../lib/market-client';
const money = (n: number) =>
  n.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
export function ScoringPanel({
  symbol,
  priceVnd,
  quoteFetchedAt,
}: {
  symbol: string;
  priceVnd: number | null;
  quoteFetchedAt: string | null;
}) {
  const [financials, setFinancials] = useState<FinancialData | null>(null),
    [notices, setNotices] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [asOf, setAsOf] = useState('');
  const settings = useScoringSettings();
  useEffect(() => {
    const controller = new AbortController();
    marketJson(
      '/v1/financials/' + encodeURIComponent(symbol),
      controller.signal,
    )
      .then((raw) => {
        const body = raw as {
          financials: FinancialData | null;
          notices: string[];
        };
        if (controller.signal.aborted) return;
        if (
          body.financials !== null &&
          (!isFinancialData(body.financials) ||
            body.financials.symbol !== symbol)
        )
          throw new Error('BCTC trả về sai mã/kiểu.');
        setFinancials(body.financials);
        setNotices(body.notices);
        setAsOf(new Date().toISOString());
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setNotices(['Không lấy được BCTC. Không tự điền số liệu hoặc điểm.']);
          setAsOf(new Date().toISOString());
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [symbol]);
  if (loading)
    return (
      <section className="scoring-section" aria-live="polite">
        <h2>Đánh giá theo chiến lược</h2>
        <p>Đang lấy báo cáo tài chính thật…</p>
      </section>
    );
  const report = scoreStock(
    financials,
    priceVnd,
    asOf,
    settings,
    quoteFetchedAt,
  );
  const last = financials?.annual.at(-1);
  return (
    <section className="scoring-section" data-testid="scoring-panel">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">GRAHAM / BUFFETT</span>
          <h2>Đánh giá theo chiến lược</h2>
        </div>
        <Link href="/settings">Cài đặt trọng số & DCF →</Link>
      </div>
      <div className="score-summary">
        <div>
          <span>Điểm tổng hợp</span>
          <strong data-testid="combined-score">
            {report.score ?? '—'} <small>/ 100</small>
          </strong>
          <p>
            Graham {settings.grahamWeight}% · Buffett {settings.buffettWeight}%
          </p>
        </div>
        <div>
          <span>Kết luận theo mô hình</span>
          <strong data-testid="score-conclusion">{report.conclusion}</strong>
          <p>
            Mức tin cậy {report.confidence}% · tiêu chí có dữ liệu{' '}
            {Math.round(report.coverage * 100)}%
          </p>
        </div>
      </div>
      <p className="data-timestamp">
        {financials
          ? `Nguồn: KBS + Vietcap · kỳ năm ${last?.year ?? 'chưa có'} · nhận ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(financials.fetchedAt))}`
          : 'Chưa có nguồn BCTC.'}{' '}
        · {report.confidenceLabel}. Thiếu dữ liệu không đồng nghĩa doanh nghiệp
        xấu.
      </p>
      {notices.map((n) => (
        <p className="data-warning" key={n}>
          {n}
        </p>
      ))}
      <div className="strategy-grid">
        {report.strategies.map((s) => (
          <article
            className="strategy-card"
            key={s.id}
            data-testid={'strategy-' + s.id}
          >
            <div className="detail-heading">
              <h3>{s.name}</h3>
              <strong>{s.score}/100</strong>
            </div>
            <p>
              Giá trị nội tại:{' '}
              <b data-testid={`intrinsic-${s.id}`}>
                {s.intrinsicVnd.ok
                  ? money(s.intrinsicVnd.value) + ' VND'
                  : 'Không đủ dữ liệu'}
              </b>
            </p>
            <p>
              Biên an toàn:{' '}
              <b data-testid={`mos-${s.id}`}>
                {s.marginOfSafety.ok
                  ? (s.marginOfSafety.value * 100).toFixed(1) + '%'
                  : 'Không đủ dữ liệu'}
              </b>
            </p>
            <small>{s.valuationLabel}</small>
            {s.scenario && (
              <div className="data-warning">
                <p>{s.scenario.label}</p>
                <p>
                  Giá trị kịch bản:{' '}
                  <b data-testid="dcf-scenario-value">
                    {s.scenario.valueVnd.ok
                      ? money(s.scenario.valueVnd.value) + ' VND'
                      : 'Không đủ dữ liệu'}
                  </b>
                </p>
                <p>
                  Biên kịch bản:{' '}
                  <b data-testid="dcf-scenario-mos">
                    {s.scenario.marginOfSafety.ok
                      ? (s.scenario.marginOfSafety.value * 100).toFixed(1) + '%'
                      : 'Không đủ dữ liệu'}
                  </b>
                </p>
              </div>
            )}
            <ul className="criteria-list">
              {s.criteria.map((c) => (
                <li
                  key={c.id}
                  data-testid={`criterion-${s.id}-${c.id}`}
                  data-status={c.status}
                >
                  <div>
                    <span className={'criterion-status ' + c.status}>
                      {c.status === 'pass'
                        ? 'Đạt'
                        : c.status === 'fail'
                          ? 'Không đạt'
                          : 'Thiếu dữ liệu'}
                    </span>
                    <b>{c.label}</b>
                    <small>{c.weight} điểm</small>
                  </div>
                  <p>{c.explanation}</p>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {last && (
        <details className="financial-table">
          <summary>Số liệu tài chính năm {last.year}</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Chỉ tiêu</th>
                  {financials!.annual.map((a) => (
                    <th key={a.year}>{a.year}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Doanh thu (tỷ VND)', 'revenueVnd', 1e9],
                    ['LN sau thuế (tỷ VND)', 'netProfitVnd', 1e9],
                    ['LN công ty mẹ (tỷ VND)', 'parentProfitVnd', 1e9],
                    ['EPS năm (VND)', 'epsAnnualVnd', 1],
                    ['BVPS công ty mẹ (VND)', 'bvpsVnd', 1],
                    ['ROE (%)', 'roe', 0.01],
                    ['ROA (%)', 'roa', 0.01],
                    ['ROIC năm (%)', 'roic', 0.01],
                    ['Biên gộp (%)', 'grossMargin', 0.01],
                    ['Biên ròng (%)', 'netMargin', 0.01],
                    ['Nợ vay/vốn chủ (%)', 'debtToEquity', 0.01],
                    ['FCF (tỷ VND)', 'freeCashFlowVnd', 1e9],
                    [
                      'Cổ tức đã trả, tập đoàn (tỷ VND)',
                      'dividendsPaidVnd',
                      1e9,
                    ],
                  ] as const
                ).map(([label, key, scale]) => (
                  <tr key={key} data-testid={`financial-${key}`}>
                    <th>{label}</th>
                    {financials!.annual.map((a) => (
                      <td key={a.year}>
                        {a[key] === null
                          ? '—'
                          : (a[key]! / scale).toLocaleString('vi-VN', {
                              maximumFractionDigits: 2,
                            })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details open className="score-risks">
        <summary>Rủi ro chính và giới hạn</summary>
        <ul>
          {report.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
      <p>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</p>
    </section>
  );
}
