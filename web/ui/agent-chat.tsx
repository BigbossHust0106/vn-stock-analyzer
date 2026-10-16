'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './auth-provider';
import { settingsClient } from '../lib/scoring-settings';
import { apiBase } from '../lib/notifications';
import type { AgentReply } from '../../modules/agent/plan';
export async function agentRequest<T>(
  owner: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const db = await settingsClient(),
    {
      data: { session },
    } = await db.auth.getSession();
  if (!session || session.user.id !== owner)
    throw Error('Phiên đã thay đổi. Hãy đăng nhập lại.');
  const r = await fetch(apiBase() + '/v1/agent', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(45000),
  });
  const j = (await r.json()) as { error?: string };
  if (!r.ok) throw Error(j.error ?? 'AI chưa sẵn sàng.');
  return j as T;
}
interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: AgentReply;
}
export function AgentChat() {
  const { user } = useAuth();
  const [sessionOwner, setSessionOwner] = useState<string | null>(
    user?.id ?? null,
  );
  useEffect(() => {
    let disposed = false,
      unsubscribe: (() => void) | undefined;
    void settingsClient()
      .then((db) => {
        if (disposed) return;
        const { data } = db.auth.onAuthStateChange((_event, session) =>
          setSessionOwner(session?.user.id ?? null),
        );
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => {
        if (!disposed) setSessionOwner(null);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  return user && sessionOwner === user.id ? (
    <Conversation key={user.id} owner={user.id} />
  ) : null;
}
function Conversation({ owner }: { owner: string }) {
  const [turns, setTurns] = useState<Turn[]>([]),
    [question, setQuestion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState<{
      available: boolean;
      privacy: string;
    } | null>(null);
  const sequence = useRef(0),
    active = useRef<AbortController | null>(null),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void agentRequest<{ available: boolean; privacy: string }>(
      owner,
      undefined,
      controller.signal,
    )
      .then(setStatus)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [owner]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [turns, busy]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    const history = [
      ...turns.filter((t) => t.role === 'user').map((t) => t.text),
      text,
    ].slice(-6);
    const turn: Turn = { id: ++sequence.current, role: 'user', text };
    setTurns((previous) => [...previous, turn]);
    setQuestion('');
    setError('');
    setBusy(true);
    const controller = new AbortController();
    active.current = controller;
    try {
      const reply = await agentRequest<AgentReply>(
        owner,
        { op: 'chat', messages: history },
        AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
      );
      if (!controller.signal.aborted)
        setTurns((previous) => [
          ...previous,
          {
            id: ++sequence.current,
            role: 'assistant',
            text: reply.text,
            reply,
          },
        ]);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Không gửi được yêu cầu.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function resolve(turn: Turn, op: 'confirm' | 'cancel') {
    if (busy || !turn.reply?.proposal) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    active.current = controller;
    try {
      const reply = await agentRequest<
        AgentReply & { resolution: { status: string } }
      >(
        owner,
        { op, id: turn.reply.proposal.id },
        AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
      );
      if (controller.signal.aborted) return;
      setTurns((previous) => [
        ...previous.map((t) =>
          t.id === turn.id && t.reply?.proposal
            ? {
                ...t,
                reply: {
                  ...t.reply,
                  proposal: {
                    ...t.reply.proposal,
                    status: reply.resolution.status,
                  },
                },
              }
            : t,
        ),
        { id: ++sequence.current, role: 'assistant', text: reply.text },
      ]);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          (e instanceof Error ? e.message : 'Không kết nối được.') +
            ' Chưa xác nhận kết quả. Nếu mất mạng sau khi gửi, xác nhận lại cùng đề xuất để kiểm tra; hệ thống không áp dụng trùng.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="agent-page">
      <span className="eyebrow">VN STOCK · TRỢ LÝ AI</span>
      <h1>Hỏi dữ liệu. Hiểu chiến lược. Quản lý theo dõi.</h1>
      <p>
        AI diễn giải yêu cầu; số liệu và giải thích lấy từ engine có nguồn. Mọi
        thay đổi đều cần bạn xác nhận. Chỉ mang tính tham khảo, không phải lời
        khuyên đầu tư.
      </p>
      <details className="agent-privacy">
        <summary>Quyền riêng tư và giới hạn</summary>
        <p>
          {status?.privacy ??
            'Hội thoại giữ trong bộ nhớ trang và được xóa khi rời trang/đổi tài khoản. Đề xuất thay đổi được lưu riêng trong tài khoản để xác nhận.'}
        </p>
        <p>
          Tối đa3 yêu cầu/phút,30/giờ,100/ngày cho mỗi tài khoản. Mỗi lượt đọc
          tối đa3 mã; không đặt lệnh giao dịch. Đơn vị giá là VND; kiểm tra kỹ
          giá trước khi xác nhận.
        </p>
      </details>
      {status?.available === false && (
        <p role="alert">
          Workers AI chưa được cấu hình. Bạn vẫn có thể tra cứu mã và quản lý
          watchlist ở các trang hiện có.
        </p>
      )}
      <div className="agent-examples">
        {[
          'Phân tích FPT',
          'So sánh VNM và HPG',
          'Xem watchlist và cảnh báo của tôi',
          'Tạo danh sách Dài hạn',
        ].map((text) => (
          <button key={text} disabled={busy} onClick={() => setQuestion(text)}>
            {text}
          </button>
        ))}
      </div>
      <section
        className="agent-conversation"
        aria-label="Hội thoại trợ lý AI"
        aria-busy={busy}
      >
        {turns.length === 0 && (
          <p className="empty-state">
            Bắt đầu bằng một mã cổ phiếu hoặc yêu cầu quản lý danh sách.
          </p>
        )}
        {turns.map((t) => (
          <article className={'agent-turn agent-' + t.role} key={t.id}>
            <strong>{t.role === 'user' ? 'Bạn' : 'VN Stock AI'}</strong>
            {t.text.length > 1800 ? (
              <details open={!!t.reply?.proposal}>
                <summary>
                  {t.text.slice(0, 250)}… · Xem phân tích đầy đủ
                </summary>
                <p className="agent-text">{t.text}</p>
              </details>
            ) : (
              <p className="agent-text">{t.text}</p>
            )}
            {!!t.reply?.sources.length && (
              <ul className="agent-sources">
                {t.reply.sources.map((s, i) => (
                  <li key={i}>
                    {s.url.startsWith('/') && !s.url.startsWith('//') ? (
                      <Link href={s.url}>{s.label}</Link>
                    ) : /^https:\/\/(cafef\.vn|vietstock\.vn|vneconomy\.vn|vnexpress\.net)\//.test(
                        s.url,
                      ) ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.label}
                      </a>
                    ) : (
                      s.label
                    )}
                    {s.receivedAt && (
                      <small>
                        {' '}
                        ·{' '}
                        {new Date(s.receivedAt).toLocaleString('vi-VN', {
                          timeZone: 'Asia/Ho_Chi_Minh',
                        })}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {t.reply?.proposal && (
              <div className="agent-proposal" data-testid="agent-proposal">
                <h3>Xem trước thao tác</h3>
                <p>{t.reply.proposal.summary}</p>
                <p>
                  Hết hạn:{' '}
                  {new Date(t.reply.proposal.expiresAt).toLocaleTimeString(
                    'vi-VN',
                    { timeZone: 'Asia/Ho_Chi_Minh' },
                  )}{' '}
                  giờ Việt Nam.
                </p>
                {t.reply.proposal.status === 'pending' ? (
                  <div>
                    <button
                      disabled={busy}
                      onClick={() => void resolve(t, 'confirm')}
                    >
                      Xác nhận thao tác
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void resolve(t, 'cancel')}
                    >
                      Hủy đề xuất
                    </button>
                  </div>
                ) : (
                  <p>
                    {t.reply.proposal.status === 'applied'
                      ? 'Đã áp dụng'
                      : 'Đã hủy'}
                  </p>
                )}
              </div>
            )}
          </article>
        ))}
        {busy && <p role="status">Đang xử lý yêu cầu…</p>}
        <div ref={end} />
      </section>
      {error && <p role="alert">{error}</p>}
      <form className="agent-composer" onSubmit={(e) => void send(e)}>
        <label htmlFor="agent-question">Yêu cầu của bạn</label>
        <textarea
          id="agent-question"
          value={question}
          maxLength={1500}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ví dụ: Thêm FPT vào danh sách Dài hạn"
          rows={3}
          disabled={busy}
        />
        <div>
          <button
            disabled={busy || !question.trim() || status?.available === false}
          >
            Gửi yêu cầu
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTurns([]);
              setError('');
              setQuestion('');
            }}
          >
            Xóa hội thoại trên thiết bị
          </button>
        </div>
      </form>
    </div>
  );
}
