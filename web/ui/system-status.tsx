'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiBase } from '../lib/notifications';
import { formatTime } from '../lib/rankings';
interface JobRow {
  id: string;
  job: string;
  scheduled_at: string;
  started_at: string;
  finished_at: string | null;
  lease_until: string;
  attempts: number;
  state: string;
  code: string | null;
}
interface StatusData {
  asOf: string;
  freshness: Record<string, string | null>;
  status: {
    component: string;
    state: string;
    last_success_at: string | null;
    updated_at: string;
  }[];
  jobs: JobRow[];
  health: {
    provider: string;
    state: string;
    checked_at: string;
    last_success_at: string | null;
    latency_ms: number | null;
    code: string | null;
  }[];
  sources: {
    id: string;
    name: string;
    state: string;
    checked_at: string;
    note: string;
  }[];
  configuration: { email: boolean; llm: boolean };
  notice: string;
}
const names: Record<string, string> = {
  prices: 'Giá trong phiên',
  closing: 'Chốt phiên',
  market: 'Đồng bộ thị trường',
  news: 'Tin tức',
  rankings: 'Điểm & xếp hạng',
  alerts: 'Cảnh báo watchlist',
  email: 'Email',
  vps: 'Kiểm tra VPS',
  ingest: 'Ingest cuối ngày',
};
const states: Record<string, string> = {
  running: 'Đang chạy',
  ok: 'Thành công',
  skipped: 'Bỏ qua',
  degraded: 'Chưa đầy đủ',
  failed: 'Lỗi',
  interrupted: 'Chưa ghi nhận kết thúc',
};
const codes: Record<string, string> = {
  JOB_FAILED: 'Tác vụ lỗi sau số lần thử giới hạn; giữ dữ liệu đã có.',
  SESSION_CLOSED: 'Không đủ điều kiện phiên giao dịch để cập nhật.',
  CALENDAR_MISSING:
    'Thiếu lịch phiên có nguồn; không tự giả định ngày giao dịch.',
  PARTIAL_SYNC: 'Một phần dữ liệu hoặc bước xử lý chưa thành công.',
  NEWS_LLM_UNCONFIGURED: 'Chưa cấu hình phân tích tin; RSS vẫn được thu nhận.',
  EMAIL_UNCONFIGURED: 'Email chưa cấu hình; thông báo trong app vẫn hoạt động.',
  NO_DATA: 'Không đủ dữ liệu.',
  SOURCE_UNAVAILABLE: 'Nguồn/API không sẵn sàng.',
};
export function SystemStatus() {
  const [data, setData] = useState<StatusData | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false,
      pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const r = await fetch(apiBase() + '/v1/system-status', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!r.ok) throw Error('Không tải được trạng thái hệ thống.');
        const value = (await r.json()) as StatusData;
        if (!stopped) {
          setData(value);
          setError('');
        }
      } catch {
        if (!stopped)
          setError(
            'Không tải được trạng thái mới; các thời điểm bên dưới thuộc lần đọc trước.',
          );
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [revision]);
  const now = Date.parse(data?.asOf ?? ''),
    jobState = (job: JobRow) =>
      job.state === 'running' && Date.parse(job.lease_until) < now
        ? 'interrupted'
        : job.state;
  const errors =
    data?.jobs.filter((j) =>
      ['failed', 'degraded', 'interrupted'].includes(jobState(j)),
    ) ?? [];
  return (
    <div className="phase4-page system-page" data-testid="system-status">
      <div className="section-heading">
        <div>
          <span className="eyebrow">VẬN HÀNH & CHẤT LƯỢNG DỮ LIỆU</span>
          <h1>Trạng thái hệ thống</h1>
          <p>Thời điểm theo giờ Việt Nam · tự làm mới mỗi 30 giây.</p>
        </div>
        <button onClick={() => setRevision((v) => v + 1)}>
          Làm mới trạng thái
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Đang đọc trạng thái…</p>
      ) : (
        <>
          <small>
            Đọc dữ liệu lúc {formatTime(data.asOf)}. {data.notice}
          </small>
          <div className="status-metrics">
            {[
              ['prices', 'Giá VPS', 15 * 60000],
              ['scores', 'Điểm đánh giá', 36 * 3600000],
              ['news', 'Tin tức', 2 * 3600000],
            ].map(([key, label, ttl]) => {
              const time = data.freshness[String(key)],
                fresh =
                  !!time &&
                  now - Date.parse(time) <= Number(ttl) &&
                  Date.parse(time) <= now;
              return (
                <article
                  className="watch-card"
                  key={String(key)}
                  data-testid={'status-' + key}
                >
                  <span className="eyebrow">{label}</span>
                  <strong>{formatTime(time ?? null)}</strong>
                  <span
                    className={
                      'system-pill ' + (fresh ? 'state-ok' : 'state-degraded')
                    }
                  >
                    {time
                      ? fresh
                        ? 'Có snapshot gần đây'
                        : 'Snapshot cũ'
                      : 'không đủ dữ liệu'}
                  </span>
                  <small>
                    {key === 'prices'
                      ? 'Giá có thể cũ ngoài giờ giao dịch; đây là thời điểm nhận, không phải dấu thời gian sàn.'
                      : key === 'scores'
                        ? 'Thời điểm tính điểm không bảo đảm đã đủ tiêu chí xếp hạng.'
                        : 'Thời điểm nhận RSS; không đồng nghĩa đã được LLM phân tích.'}
                  </small>
                </article>
              );
            })}
          </div>
          <section className="watch-card">
            <h2>Tình trạng API VPS</h2>
            {!data.health.length ? (
              <p>Chưa có phép kiểm tra; không đủ dữ liệu.</p>
            ) : (
              data.health.map((h) => (
                <div key={h.provider} data-testid="vps-health">
                  <span
                    className={
                      'system-pill ' +
                      (h.state === 'ok' &&
                      now - Date.parse(h.checked_at) <= 45 * 60000
                        ? 'state-ok'
                        : 'state-degraded')
                    }
                  >
                    {now - Date.parse(h.checked_at) > 45 * 60000
                      ? 'Kết quả kiểm tra đã cũ'
                      : h.state === 'ok'
                        ? 'API phản hồi dữ liệu hợp lệ'
                        : 'Không kết nối/đọc được dữ liệu'}
                  </span>
                  <p>
                    Kiểm tra: {formatTime(h.checked_at)} · Thành công gần nhất:{' '}
                    {formatTime(h.last_success_at)} · Độ trễ{' '}
                    {h.latency_ms ?? '—'} ms
                  </p>
                  <small>
                    Phép thử thực tế một mã ACB qua VPS. API phản hồi không xác
                    nhận giá khớp mới hoặc tính đầy đủ của thị trường.
                  </small>
                </div>
              ))
            )}
          </section>
          <div className="status-columns">
            <section className="watch-card">
              <h2>Tin & dịch vụ tùy chọn</h2>
              <p>
                Phân tích tin:{' '}
                {data.configuration.llm
                  ? 'Đã có cấu hình; xem kết quả từng tin'
                  : 'Chưa cấu hình LLM'}
              </p>
              <p>
                Email:{' '}
                {data.configuration.email
                  ? 'Đã có cấu hình Resend; xem biên nhận từng thông báo'
                  : 'Chưa cấu hình, dùng thông báo trong app'}
              </p>
              <p>
                Tin được phân tích gần nhất:{' '}
                {formatTime(data.freshness.newsAnalyzed ?? null)}
              </p>
              {data.sources.map((s) => (
                <p key={s.id}>
                  <b>{s.name}</b> ·{' '}
                  {s.state === 'ok'
                    ? 'RSS hoạt động'
                    : s.state === 'policy_blocked'
                      ? 'Chưa xác nhận quyền sử dụng'
                      : s.state === 'robots_blocked'
                        ? 'Robots không cho phép'
                        : 'Lỗi nguồn'}{' '}
                  · {formatTime(s.checked_at)}
                </p>
              ))}
            </section>
            <section className="watch-card">
              <h2>Lần đồng bộ thành công được ghi nhận</h2>
              {data.status.map((s) => (
                <p key={s.component}>
                  <b>{names[s.component] ?? s.component}</b> ·{' '}
                  {formatTime(s.last_success_at)}
                  <br />
                  <small>
                    {states[s.state] ?? s.state} · Trạng thái cập nhật{' '}
                    {formatTime(s.updated_at)}
                  </small>
                </p>
              ))}
              <small>
                Đối chiếu với snapshot và nhật ký bên dưới; mốc cũ có thể thuộc
                luồng đồng bộ trước đây.
              </small>
            </section>
          </div>
          <section className="watch-card">
            <h2>Lỗi và thiếu dữ liệu gần đây</h2>
            {!errors.length ? (
              <p>
                Chưa có lỗi trong {data.jobs.length} lượt chạy gần nhất được
                lưu; không suy ra hệ thống chưa từng lỗi.
              </p>
            ) : (
              <ul>
                {errors.slice(0, 12).map((j) => (
                  <li key={j.id}>
                    <b>{names[j.job] ?? j.job}</b> · {formatTime(j.started_at)}{' '}
                    · {states[jobState(j)]}.{' '}
                    {j.code
                      ? (codes[j.code] ?? 'Không đủ dữ liệu lỗi.')
                      : 'Lượt chạy chưa ghi nhận kết thúc; cần đối chiếu log Worker.'}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2>Nhật ký cron gần đây</h2>
            {!data.jobs.length ? (
              <p>Chưa có lượt chạy được ghi nhận sau khi cài logging.</p>
            ) : (
              <div className="table-scroll">
                <table className="plan-table">
                  <thead>
                    <tr>
                      <th>Tác vụ</th>
                      <th>Lịch chạy</th>
                      <th>Kết thúc</th>
                      <th>Kết quả</th>
                      <th>Lần thử</th>
                      <th>Diễn giải</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <tr key={j.id}>
                        <th>{names[j.job] ?? j.job}</th>
                        <td>{formatTime(j.scheduled_at)}</td>
                        <td>{formatTime(j.finished_at)}</td>
                        <td>
                          <span className={'system-pill state-' + jobState(j)}>
                            {states[jobState(j)] ?? j.state}
                          </span>
                        </td>
                        <td>{j.attempts}/2</td>
                        <td>
                          {j.code ? (codes[j.code] ?? 'không đủ dữ liệu') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p>
            Cảnh báo được kiểm tra mỗi 5 phút; giá theo lịch trong phiên; tin
            tức mỗi 30 phút. Ngày giao dịch cần có lịch phiên được xác minh.{' '}
            <Link href="/alerts">Mở hộp thông báo ↗</Link>
          </p>
        </>
      )}
    </div>
  );
}
