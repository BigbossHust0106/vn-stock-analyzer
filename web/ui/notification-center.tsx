'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './auth-provider';
import { settingsClient } from '../lib/scoring-settings';
import {
  notificationRequest,
  type NotificationFeed,
} from '../lib/notifications';
import { formatNumber, formatTime, horizonLabels } from '../lib/rankings';
import {
  alertLabels,
  type AlertKind,
  type AlertRule,
} from '../../modules/alerts/evaluate';
interface WatchChoice {
  watchlist_id: string;
  stock_id: string;
  stocks: { symbol: string };
  watchlists: { name: string };
}
interface Receipt {
  rule_id: string;
  snapshot: { config?: number; checkedAt?: string; reason?: string };
}
const emailLabels: Record<string, string> = {
  pending: 'Email đang chờ',
  sending: 'Đang gửi email',
  sent: 'Resend đã nhận email',
  failed: 'Gửi email lỗi',
  cancelled: 'Đã hủy email',
};
export function NotificationCenter() {
  const { user } = useAuth();
  return user ? <Workspace key={user.id} ownerId={user.id} /> : null;
}
function Workspace({ ownerId }: { ownerId: string }) {
  const [items, setItems] = useState<WatchChoice[]>([]),
    [rules, setRules] = useState<AlertRule[]>([]),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [selected, setSelected] = useState(''),
    [kind, setKind] = useState<AlertKind>('buy_zone'),
    [lower, setLower] = useState(''),
    [upper, setUpper] = useState(''),
    [delta, setDelta] = useState('10'),
    [horizon, setHorizon] = useState<'day' | 'month' | 'quarter'>('quarter'),
    [email, setEmail] = useState(false),
    [ruleEmail, setRuleEmail] = useState(false),
    [feed, setFeed] = useState<NotificationFeed | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(true);
  const choice = items.find(
    (i) => i.watchlist_id + ':' + i.stock_id === selected,
  );
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const db = await settingsClient(),
          [r, s, states] = await Promise.all([
            db
              .from('watchlist_alert_rules')
              .select('*')
              .order('created_at', { ascending: false }),
            db
              .from('user_settings')
              .select('email_alerts')
              .eq('owner_id', ownerId)
              .maybeSingle(),
            db.from('watchlist_alert_state').select('rule_id,snapshot'),
          ]);
        if (r.error || s.error || states.error)
          throw Error('Không tải được cài đặt cảnh báo.');
        const choices: WatchChoice[] = [];
        for (let start = 0; ; start += 1000) {
          const rows = await db
            .from('watchlist_items')
            .select('watchlist_id,stock_id,stocks(symbol),watchlists(name)')
            .order('created_at')
            .range(start, start + 999)
            .overrideTypes<WatchChoice[], { merge: false }>();
          if (rows.error) throw Error('Không tải được watchlist.');
          choices.push(...(rows.data ?? []));
          if ((rows.data?.length ?? 0) < 1000) break;
        }
        if (stopped) return;
        setRules((r.data ?? []) as AlertRule[]);
        setReceipts((states.data ?? []) as Receipt[]);
        setEmail(s.data?.email_alerts ?? false);
        setItems(choices);
        const params = new URLSearchParams(window.location.search),
          target = choices.find(
            (i) => i.stocks.symbol === params.get('symbol'),
          );
        setSelected(
          (current) =>
            current ||
            ((target ?? choices[0])
              ? [
                  (target ?? choices[0])!.watchlist_id,
                  (target ?? choices[0])!.stock_id,
                ].join(':')
              : ''),
        );
        if (revision === 0) {
          const k = params.get('kind');
          if (k && k in alertLabels) setKind(k as AlertKind);
          for (const [key, set] of [
            ['lower', setLower],
            ['upper', setUpper],
          ] as const) {
            const n = Number(params.get(key));
            if (n > 0 && n < 1e12) set(String(n));
          }
        }
      } catch (e) {
        if (!stopped)
          setMessage(
            e instanceof Error ? e.message : 'Không tải được dữ liệu.',
          );
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ownerId, revision]);
  useEffect(() => {
    let stopped = false,
      pending = false;
    const controller = new AbortController();
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const value = await notificationRequest<NotificationFeed>(
          '/v1/notifications?offset=' + page * 50,
          undefined,
          controller.signal,
        );
        if (!stopped) setFeed(value);
      } catch (e) {
        if (!stopped)
          setMessage(
            e instanceof Error ? e.message : 'Không tải được thông báo.',
          );
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [revision, page]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      window.dispatchEvent(new Event('notifications-changed'));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không lưu được.');
    } finally {
      setRevision((v) => v + 1);
      setBusy(false);
    }
  }
  function toggleRule(
    rule: AlertRule,
    patch: Partial<Pick<AlertRule, 'enabled' | 'email_enabled'>>,
  ) {
    setRules((current) =>
      current.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)),
    );
    void act(async () => {
      try {
        const db = await settingsClient();
        const { error } = await db
          .from('watchlist_alert_rules')
          .update(patch)
          .eq('id', rule.id);
        if (error) throw Error('Không lưu được tùy chọn quy tắc.');
      } catch (error) {
        setRules((current) =>
          current.map((r) => (r.id === rule.id ? rule : r)),
        );
        throw error;
      }
    });
  }
  function toggleEmail(enabled: boolean) {
    setEmail(enabled);
    void act(async () => {
      try {
        const db = await settingsClient();
        const { error } = await db
          .from('user_settings')
          .upsert({ owner_id: ownerId, email_alerts: enabled });
        if (error) throw Error('Không lưu được tùy chọn email.');
        setMessage(
          enabled
            ? 'Đã bật email; chỉ quy tắc có chọn email mới được gửi.'
            : 'Đã tắt email.',
        );
      } catch (error) {
        setEmail(!enabled);
        throw error;
      }
    });
  }
  async function saveRule() {
    if (!choice) throw Error('Chọn mã trong watchlist.');
    const db = await settingsClient();
    const price = ['buy_zone', 'sell_zone', 'stop_loss'].includes(kind),
      lo = price ? Number(lower) : null,
      hi = kind === 'buy_zone' ? Number(upper) : null,
      change = Number(delta);
    if (
      (price && (!Number.isFinite(lo) || lo! <= 0 || lo! >= 1e12)) ||
      (kind === 'buy_zone' &&
        (!Number.isFinite(hi) || hi! < lo! || hi! >= 1e12)) ||
      !Number.isFinite(change) ||
      change < 1 ||
      change > 100
    )
      throw Error('Kiểm tra vùng giá (VND) và ngưỡng điểm 1–100.');
    const { error } = await db.from('watchlist_alert_rules').upsert(
      {
        owner_id: ownerId,
        watchlist_id: choice.watchlist_id,
        stock_id: choice.stock_id,
        kind,
        lower_vnd: lo,
        upper_vnd: hi,
        score_delta: change,
        horizon: kind === 'score_change' ? horizon : 'quarter',
        email_enabled: ruleEmail,
        enabled: true,
      },
      {
        onConflict:
          'owner_id,watchlist_id,stock_id,kind,horizon,lower_vnd,upper_vnd',
      },
    );
    if (error) throw Error('Không lưu được quy tắc cảnh báo.');
    setMessage(
      'Đã lưu. Kiểm tra cảnh báo mỗi 5 phút; tin tức được thu mỗi 30 phút.',
    );
  }
  return (
    <div className="phase4-page alerts-page">
      <span className="eyebrow">THEO DÕI CỦA BẠN</span>
      <div className="section-heading">
        <div>
          <h1>Cảnh báo & thông báo</h1>
          <p>
            Giá chạm mức đã lưu, điểm thay đổi và tin quan trọng của mã trong
            watchlist.
          </p>
        </div>
        <Link href="/status">Trạng thái hệ thống ↗</Link>
      </div>
      <p role="status" data-testid="alerts-message">
        {message}
      </p>
      {loading && <p>Đang tải…</p>}
      <div className="alert-layout">
        <section className="alert-editor">
          <h2>Thiết lập cảnh báo</h2>
          <label className="alert-toggle">
            <input
              type="checkbox"
              checked={email}
              disabled={busy}
              onChange={(e) => toggleEmail(e.target.checked)}
            />
            Nhận cảnh báo qua email
          </label>
          <small>
            {feed?.emailConfigured
              ? 'Email gửi đến địa chỉ đã xác minh của tài khoản. Resend nhận yêu cầu không bảo đảm thư đã vào hộp thư.'
              : 'Email chưa sẵn sàng. Thông báo trong app vẫn hoạt động.'}
          </small>
          {!items.length && !loading ? (
            <p>
              Thêm mã vào <Link href="/watchlists">watchlist</Link> trước khi
              tạo cảnh báo.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(saveRule);
              }}
            >
              <label>
                Mã trong danh sách theo dõi
                <select
                  aria-label="Mã cảnh báo"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {items.map((i) => (
                    <option
                      key={i.watchlist_id + ':' + i.stock_id}
                      value={i.watchlist_id + ':' + i.stock_id}
                    >
                      {i.stocks.symbol} · {i.watchlists.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Loại cảnh báo
                <select
                  aria-label="Loại cảnh báo"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AlertKind)}
                >
                  {Object.entries(alertLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {['buy_zone', 'sell_zone', 'stop_loss'].includes(kind) && (
                <label>
                  {kind === 'buy_zone'
                    ? 'Giá dưới vùng mua (VND)'
                    : 'Mức giá (VND)'}
                  <input
                    required
                    type="number"
                    min="1"
                    max="999999999999"
                    step="any"
                    value={lower}
                    onChange={(e) => setLower(e.target.value)}
                  />
                </label>
              )}
              {kind === 'buy_zone' && (
                <label>
                  Giá trên vùng mua (VND)
                  <input
                    required
                    type="number"
                    min="1"
                    max="999999999999"
                    step="any"
                    value={upper}
                    onChange={(e) => setUpper(e.target.value)}
                  />
                </label>
              )}
              {kind === 'score_change' && (
                <>
                  <label>
                    Thay đổi tối thiểu (điểm)
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={delta}
                      onChange={(e) => setDelta(e.target.value)}
                    />
                  </label>
                  <label>
                    Khung điểm
                    <select
                      aria-label="Khung điểm cảnh báo"
                      value={horizon}
                      onChange={(e) =>
                        setHorizon(e.target.value as typeof horizon)
                      }
                    >
                      {Object.entries(horizonLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="alert-toggle">
                <input
                  type="checkbox"
                  checked={ruleEmail}
                  onChange={(e) => setRuleEmail(e.target.checked)}
                />
                Gửi email cho quy tắc này{' '}
                {email ? '' : '(email toàn tài khoản đang tắt)'}
              </label>
              <button disabled={busy || !choice}>Lưu quy tắc</button>
              <small>
                Vùng giá là snapshot do bạn chọn, không tự thay đổi theo biểu đồ
                hoặc trailing stop. Chỉ dùng giá khớp VPS nhận trong 15 phút;
                không dùng giá tham chiếu. Không gửi lặp khi giá vẫn ở trong
                vùng. Không xác nhận lệnh đã khớp.
              </small>
            </form>
          )}
          <button
            className="alert-test-button"
            disabled={busy || !choice}
            onClick={() =>
              void act(async () => {
                await notificationRequest('/v1/notifications/test', {
                  watchlistId: choice!.watchlist_id,
                  stockId: choice!.stock_id,
                  email,
                });
                setPage(0);
                setMessage(
                  'Đã tạo cảnh báo thử trong app.' +
                    (email
                      ? ' Email được xếp hàng khi cấu hình sẵn sàng.'
                      : ''),
                );
              })
            }
          >
            Gửi cảnh báo thử
          </button>
        </section>
        <section
          className="notification-inbox"
          data-testid="notification-inbox"
        >
          <div className="section-heading">
            <h2>
              Thông báo <small>{feed?.unread ?? '…'} chưa đọc</small>
            </h2>
            <button
              disabled={busy || !feed?.unread}
              onClick={() =>
                void act(async () => {
                  const db = await settingsClient();
                  const { error } = await db
                    .from('notifications')
                    .update({ read_at: new Date().toISOString() })
                    .is('read_at', null);
                  if (error) throw Error('Không đánh dấu được thông báo.');
                })
              }
            >
              Đọc tất cả
            </button>
          </div>
          {!feed ? (
            <p>Đang tải thông báo…</p>
          ) : !feed.data.length ? (
            <p>Chưa có thông báo. Dùng “Gửi cảnh báo thử” để kiểm tra.</p>
          ) : (
            feed.data.map((n) => (
              <article
                key={n.id}
                className={
                  'notification-card ' + (n.read_at ? '' : 'is-unread')
                }
                data-testid="notification-card"
              >
                <small>
                  {formatTime(n.created_at)}
                  {n.kind === 'test' ? ' · THỬ NGHIỆM' : ''}
                </small>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
                <div className="action-row">
                  <Link href={'/stocks?symbol=' + n.stocks.symbol}>
                    Xem {n.stocks.symbol} ↗
                  </Link>
                  {n.source_url && (
                    <a
                      href={n.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Nguồn gốc ↗
                    </a>
                  )}
                  {!n.read_at && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const db = await settingsClient();
                          const { error } = await db
                            .from('notifications')
                            .update({ read_at: new Date().toISOString() })
                            .eq('id', n.id);
                          if (error) throw Error('Không đánh dấu được.');
                        })
                      }
                    >
                      Đánh dấu đã đọc
                    </button>
                  )}
                </div>
                {feed.email
                  .filter((e) => e.notification_id === n.id)
                  .map((e) => (
                    <small key={e.notification_id}>
                      {emailLabels[e.state] ?? 'Email chưa rõ trạng thái'} ·{' '}
                      {e.attempts}/3 lần thử
                    </small>
                  ))}
              </article>
            ))
          )}
          <div className="action-row">
            <button disabled={page === 0} onClick={() => setPage((v) => v - 1)}>
              Mới hơn
            </button>
            <span>Trang {page + 1}</span>
            <button
              disabled={(feed?.data.length ?? 0) < 50}
              onClick={() => setPage((v) => v + 1)}
            >
              Cũ hơn
            </button>
          </div>
        </section>
      </div>
      <section className="alert-rules">
        <h2>Quy tắc đã lưu</h2>
        {!rules.length && <p>Chưa có quy tắc.</p>}
        <div className="watch-grid">
          {rules.map((r) => {
            const i = items.find(
                (i) =>
                  i.watchlist_id === r.watchlist_id &&
                  i.stock_id === r.stock_id,
              ),
              receipt = receipts.find((s) => s.rule_id === r.id)?.snapshot;
            return (
              <article className="watch-card" key={r.id}>
                <h3>
                  {i?.stocks.symbol ?? 'Mã theo dõi'} · {alertLabels[r.kind]}
                </h3>
                <p>
                  {i?.watchlists.name}
                  {r.kind === 'score_change'
                    ? ' · ' + horizonLabels[r.horizon]
                    : ''}
                </p>
                <strong>
                  {r.kind === 'buy_zone'
                    ? `${formatNumber(r.lower_vnd)}–${formatNumber(r.upper_vnd)} VND`
                    : ['sell_zone', 'stop_loss'].includes(r.kind)
                      ? `${formatNumber(r.lower_vnd)} VND`
                      : r.kind === 'score_change'
                        ? `${r.score_delta} điểm`
                        : 'Tin gắn mã có mức ảnh hưởng cao'}
                </strong>
                <label className="alert-toggle">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      toggleRule(r, { enabled: e.target.checked })
                    }
                  />
                  Bật {alertLabels[r.kind]} {i?.stocks.symbol}
                </label>
                <label className="alert-toggle">
                  <input
                    type="checkbox"
                    checked={r.email_enabled}
                    disabled={busy}
                    onChange={(e) =>
                      toggleRule(r, { email_enabled: e.target.checked })
                    }
                  />
                  Email quy tắc
                </label>
                <small>
                  {receipt?.config === r.config_version
                    ? `${formatTime(receipt.checkedAt ?? null)} · ${receipt.reason ?? 'Đã kiểm tra'}`
                    : 'Chờ kiểm tra cấu hình mới.'}
                </small>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const db = await settingsClient();
                      const { error } = await db
                        .from('watchlist_alert_rules')
                        .delete()
                        .eq('id', r.id);
                      if (error) throw Error('Không xóa được quy tắc.');
                    })
                  }
                >
                  Xóa quy tắc
                </button>
              </article>
            );
          })}
        </div>
      </section>
      <p className="source-note">
        Tin chưa có phân tích hợp lệ hoặc điểm thiếu bằng chứng sẽ không kích
        hoạt cảnh báo tương ứng. Cảnh báo theo snapshot có thể đến sau biến động
        giá. Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.
      </p>
    </div>
  );
}
