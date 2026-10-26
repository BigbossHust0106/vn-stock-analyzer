'use client';
import { useEffect, useState } from 'react';
import { marketJson } from '../lib/market-client';
import { formatTime, formatNumber } from '../lib/rankings';
import { factorApplies } from '../../modules/news/relevance';
import type { ClassifiedArticle } from '../../modules/news/analysis';
import type { NewsScore } from '../../modules/news/sentiment';
interface NewsResult {
  symbol: string;
  sector: string | null;
  articles: ClassifiedArticle[];
  sources: {
    id: string;
    name: string;
    state: string;
    terms_url: string;
    checked_at: string;
    note: string;
  }[];
  status: { state: string; last_success_at: string | null } | null;
  score: NewsScore;
  scope: string;
}
const sentimentLabels = {
  positive: 'Tích cực',
  neutral: 'Trung lập',
  negative: 'Tiêu cực',
};
const impactLabels = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };
const horizonLabels = {
  short: 'Ngắn hạn',
  medium: 'Trung hạn',
  long: 'Dài hạn',
};
const factorLabels = {
  macro: 'Vĩ mô',
  sector: 'Ngành',
  corporate: 'Sự kiện doanh nghiệp',
  foreign: 'Dòng tiền khối ngoại',
  liquidity: 'Thanh khoản thị trường chung',
};
const macroLabels: Record<string, string> = {
  interest: 'Lãi suất',
  fx: 'Tỷ giá',
  cpi: 'CPI / lạm phát',
  sbv: 'Chính sách NHNN',
  oil: 'Giá dầu',
  gold: 'Giá vàng',
};
export function StockNews({ symbol }: { symbol: string }) {
  const [result, setResult] = useState<NewsResult | null>(null),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [filter, setFilter] = useState('direct'),
    [limit, setLimit] = useState(6);
  useEffect(() => {
    const controller = new AbortController();
    marketJson(
      '/v1/news?symbol=' +
        encodeURIComponent(symbol) +
        (filter === 'context' ? '&scope=context' : ''),
      controller.signal,
    )
      .then((raw) => {
        const body = raw as NewsResult;
        if (
          body.symbol !== symbol ||
          !Array.isArray(body.articles) ||
          !Array.isArray(body.sources) ||
          !body.score
        )
          throw Error('Tin tức trả về không hợp lệ');
        setResult(body);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'không đủ dữ liệu');
      });
    return () => controller.abort();
  }, [symbol, refresh, filter]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((n) => n + 1);
    }, 300000);
    return () => window.clearInterval(timer);
  }, []);
  const source = (id: string) =>
    result?.sources.find((s) => s.id === id)?.name ?? id;
  const articles = (result?.articles ?? []).filter(
    (a) =>
      (filter === 'direct' && a.symbols.includes(symbol)) ||
      (filter === 'context' && !a.symbols.includes(symbol)),
  );
  return (
    <section className="news-panel" data-testid="stock-news">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">TIN TỨC & BỐI CẢNH</span>
          <h2>Điều gì đang ảnh hưởng đến {symbol}?</h2>
        </div>
        <button onClick={() => setRefresh((n) => n + 1)}>↻ Cập nhật tin</button>
      </div>
      <p>
        RSS từ CafeF, Vietstock, VnEconomy và VnExpress Kinh doanh · Cập nhật
        theo giờ. Phân tích dựa trên tiêu đề và mô tả RSS, không phải toàn văn;
        nhãn LLM có thể sai.
      </p>
      {error && (
        <p role="alert">
          {error} · không đủ dữ liệu{result ? '; đang giữ bản tải trước.' : '.'}
        </p>
      )}
      {!result && !error && <p role="status">Đang lấy tin có nguồn…</p>}
      {result && (
        <>
          <div className="news-score" data-testid="news-score">
            <strong>
              Tâm lý tin tức ·{' '}
              {result.score.score === null
                ? 'không đủ dữ liệu'
                : formatNumber(result.score.score, 1) + '/100'}
            </strong>
            <span>
              {result.score.count}/
              {result.score.candidateCount ?? result.score.count} tin trực tiếp
              đã phân tích · {result.score.sourceCount} nguồn ·{' '}
              {formatTime(result.status?.last_success_at)}
            </span>
            <p>{result.score.reason}</p>
          </div>
          <h3>Yếu tố ảnh hưởng</h3>
          <p>
            Ưu tiên bản tin nhắc trực tiếp {symbol}. Không lấy tin của mã khác
            làm bằng chứng tác động đến doanh nghiệp này. Bối cảnh chung có thể
            xem thêm bên dưới.
          </p>
          <div className="news-factor-grid">
            {Object.entries(factorLabels).map(([key, label]) => {
              const rows = result.articles
                .filter(
                  (a) =>
                    a.symbols.includes(symbol) &&
                    factorApplies(a, symbol, result.sector, key),
                )
                .slice(0, 1);
              return (
                <article key={key} data-testid={'factor-' + key}>
                  <h4>{label}</h4>
                  {rows.length ? (
                    rows.map((a) => (
                      <p key={a.id}>
                        <a
                          href={a.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {a.title}
                        </a>
                        <small>
                          {source(a.source_id)} · {formatTime(a.published_at)} ·{' '}
                          {a.analysis
                            ? sentimentLabels[a.analysis.sentiment]
                            : 'không đủ dữ liệu phân tích'}
                        </small>
                      </p>
                    ))
                  ) : (
                    <p>Chưa có tin trực tiếp cho {symbol}.</p>
                  )}
                </article>
              );
            })}
          </div>
          <details className="news-expanded" data-testid="news-expanded">
            <summary>Xem thêm tin và chi tiết về {symbol}</summary>
            <div className="news-filters" role="group" aria-label="Lọc tin">
              {[
                ['direct', 'Trực tiếp mã'],
                ['context', 'Bối cảnh ngành / thị trường'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => {
                    setFilter(key!);
                    setLimit(6);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {articles.length === 0 && (
              <p>
                không đủ dữ liệu: chưa có tin phù hợp trong phạm vi RSS 7 ngày.
              </p>
            )}
            <div className="news-list">
              {articles.slice(0, limit).map((a) => (
                <article key={a.id} data-testid="news-article">
                  <div className="news-meta">
                    {source(a.source_id)} · {formatTime(a.published_at)}
                    {!a.symbols.includes(symbol) && (
                      <span>
                        {' '}
                        · Tin bối cảnh, chưa xác nhận tác động riêng {symbol}
                      </span>
                    )}
                  </div>
                  <h3>
                    <a
                      href={a.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {a.title} ↗
                    </a>
                  </h3>
                  <div className="news-badges">
                    {a.analysis ? (
                      <>
                        <span data-sentiment={a.analysis.sentiment}>
                          {sentimentLabels[a.analysis.sentiment]}
                        </span>
                        <span>Ảnh hưởng {impactLabels[a.analysis.impact]}</span>
                        <span>{horizonLabels[a.analysis.horizon]}</span>
                      </>
                    ) : (
                      <span data-sentiment="unknown">
                        Cảm xúc / ảnh hưởng / thời hạn: không đủ dữ liệu
                      </span>
                    )}
                    {a.symbols.length > 1 && (
                      <span>
                        Nhiều mã: không dùng cảm xúc chung để chấm từng mã
                      </span>
                    )}
                    {a.macro_topics.map((t) => (
                      <span key={t}>{macroLabels[t]}</span>
                    ))}
                    {a.symbols.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                    {a.sectors.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                  <details>
                    <summary>Tóm tắt và nội dung liên quan</summary>
                    <p>{a.analysis?.summary ?? a.excerpt}</p>
                  </details>
                  {a.analysis ? (
                    <details>
                      <summary>Bằng chứng và mô hình</summary>
                      <blockquote>{a.analysis.evidence}</blockquote>
                      <small>
                        Tóm tắt trích xuất RSS · {a.model} ·{' '}
                        {formatTime(a.analyzed_at)}. Cảm xúc mô tả sắc thái tin,
                        không dự báo giá.{' '}
                        <a
                          href={a.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Đọc nguồn gốc
                        </a>
                      </small>
                    </details>
                  ) : (
                    <small>
                      Chưa có kết quả LLM hợp lệ. Đoạn trên là mô tả RSS của
                      nguồn, không phải nhận định mô hình.
                    </small>
                  )}
                </article>
              ))}
            </div>
            {articles.length > limit && (
              <button onClick={() => setLimit((n) => n + 6)}>
                Xem thêm tin
              </button>
            )}
          </details>
          <details className="news-source-status">
            <summary>Trạng thái nguồn và phạm vi dữ liệu</summary>
            <p>{result.scope}</p>
            {result.sources.map((s) => (
              <p key={s.id}>
                <a href={s.terms_url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>{' '}
                ·{' '}
                {s.state === 'ok'
                  ? 'RSS cập nhật'
                  : s.state === 'policy_blocked'
                    ? 'Tạm tắt theo điều kiện sử dụng'
                    : s.state === 'robots_blocked'
                      ? 'Robots hạn chế'
                      : 'Lỗi nguồn; có thể đang dùng tin cũ'}{' '}
                · {formatTime(s.checked_at)}
                <br />
                {s.note}
              </p>
            ))}
            {result.status?.state !== 'ok' && (
              <p>
                Pipeline chưa đầy đủ: kiểm tra nguồn hoặc cấu hình LLM. Tin chưa
                phân tích không được chấm trung lập thay thế.
              </p>
            )}
          </details>
        </>
      )}
      <p className="data-timestamp">
        Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.
      </p>
    </section>
  );
}
