'use client';
import { parentEvidence } from '../../modules/providers/document-evidence';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { scoreStock, type ScoreReport } from '../../modules/scoring/engine';
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
  onFinancials,
  onReport,
}: {
  symbol: string;
  priceVnd: number | null;
  quoteFetchedAt: string | null;
  onFinancials?: (data: FinancialData | null) => void;
  onReport?: (report: ScoreReport | null) => void;
}) {
  const [backups, setBackups] = useState<
    { source: string; fetched_at: string; last_error: string | null }[]
  >([]);
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
          backups?: {
            source: string;
            fetched_at: string;
            last_error: string | null;
          }[];
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
        setBackups(Array.isArray(body.backups) ? body.backups : []);
        onFinancials?.(body.financials);
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
  }, [symbol, onFinancials]);
  const report = useMemo(
    () => scoreStock(financials, priceVnd, asOf, settings, quoteFetchedAt),
    [financials, priceVnd, asOf, settings, quoteFetchedAt],
  );
  useEffect(() => {
    onReport?.(loading ? null : report);
  }, [loading, report, onReport]);
  if (loading)
    return (
      <section className="scoring-section" aria-live="polite">
        <h2>Đánh giá theo chiến lược</h2>
        <p>Đang lấy báo cáo tài chính thật…</p>
      </section>
    );

  const last = financials?.annual.at(-1);
  const missingCriteria = report.strategies.flatMap((strategy) =>
    strategy.criteria
      .filter((c) => c.status === 'unknown')
      .map((c) => strategy.name + ': ' + c.label),
  );
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
          <span>
            {report.coverage < 1 || !report.quoteUsable
              ? 'Điểm sàng lọc tạm tính'
              : 'Điểm tổng hợp'}
          </span>
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
          ? `Nguồn: ${financials.source === 'FIREANT_VIETCAP' ? 'FireAnt + Vietcap (dự phòng khi KBS lỗi)' : 'KBS + Vietcap'} · kỳ năm ${last?.year ?? 'chưa có'} · nhận ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(financials.fetchedAt))}`
          : 'Chưa có nguồn BCTC.'}{' '}
        · {report.confidenceLabel}. Thiếu dữ liệu không đồng nghĩa doanh nghiệp
        xấu.
      </p>
      {(report.coverage < 1 || !report.quoteUsable) && (
        <div className="data-warning" data-testid="comparison-status">
          <strong>Chưa đủ dữ liệu để so sánh và xếp hạng.</strong>
          <p>
            Điểm tạm chỉ mô tả các tiêu chí đã kiểm tra; không đủ cơ sở kết luận
            mã này tốt hơn mã khác.
          </p>
          <ul>
            {missingCriteria.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
            {!report.quoteUsable && (
              <li>Chưa xác minh thời điểm nguồn của giá giao dịch.</li>
            )}
          </ul>
        </div>
      )}
      <p className="criterion-legend">
        “Không đạt” = đã có số liệu nhưng chưa đạt ngưỡng. “Thiếu dữ liệu” =
        chưa thể kiểm tra. Xem giá trị thực của từng năm bên dưới.
      </p>
      {notices.map((n) => (
        <p className="data-warning" key={n}>
          {n}
        </p>
      ))}
      <details className="financial-backups" data-testid="financial-backups">
        <summary>Nguồn BCTC chính và dự phòng</summary>
        <p>
          KBS: số liệu chuẩn hóa cho cả Graham và Buffett; Vietcap: ratios và
          kho báo cáo dự phòng độc lập. Khi KBS lỗi, FireAnt (nếu đã cấu hình)
          thay cho KBS, đối chiếu LNST công ty mẹ với Vietcap. Không tự coi số
          raw là đã kiểm toán/hợp nhất.
        </p>
        {backups.length ? (
          backups.map((b) => (
            <p key={b.source}>
              Vietcap · đã lưu 3 loại báo cáo · nhận{' '}
              {formatBackupDate(b.fetched_at)}.{' '}
              {b.last_error ??
                'Chỉ lưu bản nguồn; chưa dùng thay đầu vào chấm điểm.'}{' '}
              <a
                href={
                  'https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/' +
                  symbol +
                  '/financial-statement?section=INCOME_STATEMENT'
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Xem nguồn BCTC
              </a>
            </p>
          ))
        ) : (
          <p>
            Chưa lưu được báo cáo dự phòng cho mã này. Cron sẽ thử nguồn lại;
            không tự điền phần thiếu.
          </p>
        )}
      </details>
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
        <details open className="financial-table">
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
                    ['Tài sản ngắn hạn (tỷ VND)', 'currentAssetsVnd', 1e9],
                    ['Nợ ngắn hạn (tỷ VND)', 'currentLiabilitiesVnd', 1e9],
                    ['Nợ dài hạn (tỷ VND)', 'longTermLiabilitiesVnd', 1e9],
                    ['Vốn chủ sở hữu (tỷ VND)', 'equityVnd', 1e9],
                    [
                      'Lợi ích CĐ không kiểm soát (tỷ VND)',
                      'minorityEquityVnd',
                      1e9,
                    ],
                    ['CFO hợp nhất (tỷ VND)', 'operatingCashFlowVnd', 1e9],
                    ['Capex hợp nhất (tỷ VND)', 'capexVnd', 1e9],
                    ['FCF (tỷ VND)', 'freeCashFlowVnd', 1e9],
                    ['Số cổ phiếu cuối năm', 'sharesOutstanding', 1],
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
                {financials!.documentEvidence?.length
                  ? (
                      [
                        [
                          'Cổ tức đã trả, công ty mẹ (tỷ VND)',
                          'dividendsPaidVnd',
                        ],
                        ['CFO công ty mẹ (tỷ VND)', 'operatingCashFlowVnd'],
                        ['Capex công ty mẹ (tỷ VND)', 'capexVnd'],
                      ] as const
                    ).map(([label, field]) => (
                      <tr
                        key={'parent-' + field}
                        data-testid={'financial-parent-' + field}
                      >
                        <th>{label}</th>
                        {financials!.annual.map((a) => {
                          const evidence = parentEvidence(
                            financials!.documentEvidence,
                            a.year,
                            asOf,
                          );
                          return (
                            <td key={a.year}>
                              {evidence
                                ? (evidence[field] / 1e9).toLocaleString(
                                    'vi-VN',
                                    { maximumFractionDigits: 3 },
                                  )
                                : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!!financials?.documentEvidence?.length && (
        <div className="document-sources" data-testid="document-sources">
          <h3>Bằng chứng từ báo cáo gốc</h3>
          <p>
            Chỉ các dòng cổ tức, CFO và Capex công ty mẹ dưới đây đã được đối
            chiếu PDF. Không suy ra toàn bộ BCTC hay Owner Earnings đã được xác
            minh; CFO riêng vẫn chưa đủ đầu vào DCF Buffett.
          </p>
          <ul>
            {financials.documentEvidence
              .filter((e) => Date.parse(e.verifiedAt) <= Date.parse(asOf))
              .map((e) => (
                <li key={e.year}>
                  <a
                    href={e.sourceUrl + '#page=' + e.pdfPage}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {e.year}: BCTC riêng kiểm toán · trang PDF {e.pdfPage}
                  </a>{' '}
                  · Cổ tức đã trả {money(e.dividendsPaidVnd)} VND
                </li>
              ))}
          </ul>
        </div>
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

function formatBackupDate(value: string) {
  const t = Date.parse(value);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'chưa xác minh';
}
