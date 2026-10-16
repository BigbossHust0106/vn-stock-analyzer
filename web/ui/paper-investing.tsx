'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLivePrices } from './use-live-prices';
import { portfolioValue } from '../../modules/paper/accounting';
import { useAuth } from './auth-provider';
import { paperRequest, PaperError, type PaperState } from '../lib/paper';
import {
  estimateOrder,
  type PaperQuote,
  type PaperTrade,
  type PaperWallet,
} from '../../modules/paper/accounting';
import { formatTime } from '../lib/rankings';
const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? 'Không đủ dữ liệu'
    : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n) +
      ' ₫';
const num = (n: number) =>
  n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
type Intent = {
  walletId: string;
  quoteId: string;
  side: 'buy' | 'sell';
  quantity: number;
  requestId: string;
  acceptCached: boolean;
};
export function PaperInvesting() {
  const { user } = useAuth();
  return <PaperWorkspace key={user?.id ?? 'pending'} />;
}
function PaperWorkspace() {
  const [walletId, setWalletId] = useState<string | null>(null),
    [cursor, setCursor] = useState<{ before: string; id: string } | null>(null),
    [data, setData] = useState<PaperState | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Intent | null>(null);
  const [symbol, setSymbol] = useState(() => {
      const s =
        typeof window === 'undefined'
          ? null
          : new URLSearchParams(window.location.search).get('symbol');
      return s && /^[A-Z0-9]{3,12}$/.test(s) ? s : 'FPT';
    }),
    [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [quantity, setQuantity] = useState(100),
    [mode, setMode] = useState<'source' | 'cached'>('source'),
    [quote, setQuote] = useState<PaperQuote | null>(null),
    [accept, setAccept] = useState(false),
    [clock, setClock] = useState(() => Date.now());
  const generation = useRef(0);
  const read = useCallback(
    async (id: string | null = walletId, page: typeof cursor = cursor) => {
      const version = ++generation.current,
        query = new URLSearchParams({ ...page, ...(id ? { wallet: id } : {}) });
      const result = await paperRequest<PaperState>(
        '/v1/paper?' + query.toString(),
      );
      if (version === generation.current) {
        setData(result);
        setLoadError('');
      }
      return result;
    },
    [walletId, cursor],
  );
  const cancelRead = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!document.hidden)
        void read().catch((e) => {
          if (active)
            setLoadError(
              e instanceof Error ? e.message : 'Chưa tải được ví thử.',
            );
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => {
      active = false;
      cancelRead();
      window.clearInterval(timer);
    };
  }, [read, cancelRead]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  function changeWallet(id: string) {
    setWalletId(id);
    setCursor(null);
    setQuote(null);
    setData(null);
    setMessage('');
  }
  async function getQuote() {
    if (busy || pending) return;
    setBusy(true);
    setError('');
    setQuote(null);
    setAccept(false);
    try {
      const r = await paperRequest<{ data: PaperQuote }>('/v1/paper/quote', {
        symbol,
        mode,
      });
      setQuote(r.data);
      setClock(Date.now());
      await read();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa đọc được giá.');
    } finally {
      setBusy(false);
    }
  }
  async function execute(intent: Intent) {
    if (busy) return;
    setBusy(true);
    setPending(intent);
    setError('');
    setMessage('');
    try {
      const r = await paperRequest<{ data: PaperTrade }>(
        '/v1/paper/orders',
        intent,
      );
      setPending(null);
      setQuote(null);
      setCursor(null);
      setMessage(
        `Đã ${r.data.side === 'buy' ? 'mua' : 'bán'} thử ${num(r.data.quantity)} ${r.data.symbol} ở giá ${money(r.data.price_vnd)}. Đây là giao dịch tiền ảo.`,
      );
      await read(intent.walletId, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa xác nhận giao dịch.');
      if (e instanceof PaperError && e.status < 500) {
        setPending(null);
        if (['PAPER_QUOTE_EXPIRED', 'PAPER_QUOTE_USED'].includes(e.code))
          setQuote(null);
      }
      try {
        const state = await read(intent.walletId, null);
        if (state.trades.some((t) => t.request_id === intent.requestId)) {
          setPending(null);
          setQuote(null);
          setError('');
          setMessage('Đã tìm thấy giao dịch trong lịch sử; không gửi lại.');
        }
      } catch {
        /* Retain the exact intent for a safe retry. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function checkPending() {
    if (!pending) return;
    try {
      const r = await read(pending.walletId, null);
      if (r.trades.some((t) => t.request_id === pending.requestId)) {
        setPending(null);
        setQuote(null);
        setError('');
        setMessage('Giao dịch đã ghi nhận trong lịch sử.');
      } else
        setMessage(
          'Chưa tìm thấy trong trang lịch sử mới nhất. Có thể thử lại cùng yêu cầu để xác nhận, không tạo yêu cầu mới.',
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa đọc được lịch sử.');
    }
  }
  const live = useLivePrices(data?.positions.map((p) => p.symbol) ?? []);
  const wallet = data?.wallet,
    valuation = wallet
      ? portfolioValue(
          wallet,
          (data?.positions ?? []).map((p) => {
            const q = live.prices[p.symbol];
            return q?.last_price_vnd &&
              (!p.mark ||
                Date.parse(q.fetched_at) > Date.parse(p.mark.observed_at))
              ? {
                  ...p,
                  mark: {
                    price_vnd: q.last_price_vnd,
                    observed_at: q.fetched_at,
                    mode: 'source_response',
                    price_date: null,
                  },
                }
              : p;
          }),
        )
      : null,
    estimate =
      quote && wallet
        ? estimateOrder(
            quote.price_vnd,
            quantity,
            wallet.fee_bps,
            wallet.tax_bps,
            side,
          )
        : null;
  const held = valuation?.rows.find((p) => p.symbol === symbol)?.quantity ?? 0;
  const expired = !!quote && Date.parse(quote.expires_at) <= clock;
  const canOrder =
    !!wallet &&
    !!quote &&
    !!estimate &&
    !expired &&
    (quote.mode !== 'cached' || accept) &&
    (side === 'buy'
      ? wallet.cash_vnd + estimate.cashDelta >= 0
      : held >= quantity);
  return (
    <div className="paper-page">
      <section className="paper-intro">
        <span className="eyebrow">HỌC ĐẦU TƯ BẰNG TRẢI NGHIỆM</span>
        <h1>Phòng đầu tư thử</h1>
        <p>Tự cấp vốn ảo, thử mua bán và theo dõi quyết định của bạn.</p>
        <strong className="paper-label">
          TIỀN ẢO · KHÔNG GỬI LỆNH TỚI CÔNG TY CHỨNG KHOÁN
        </strong>
        <details className="paper-notice">
          <summary>Giả định mô phỏng cần biết</summary>
          <p>
            Mỗi lệnh khớp thử toàn bộ ở giá đã xác nhận, ghi nhận ngay cả ngoài
            phiên; chưa mô phỏng thanh khoản, trượt giá, T+2, cổ tức/quyền
            mua/chia tách. Chỉ lô 100, không margin hoặc bán khống. Giá có thể
            cũ, thời gian nhận không xác nhận thời gian khớp tại sàn. Kết quả ví
            thử không chứng minh lợi nhuận có thể thực hiện trong tài khoản
            thật.
          </p>
        </details>
      </section>
      {(error || loadError) && (
        <p role="alert" className="paper-notice">
          {error || loadError}
        </p>
      )}
      {message && (
        <p role="status" className="paper-notice">
          {message}
        </p>
      )}
      {!data && !error && !loadError && <p role="status">Đang tải ví thử…</p>}
      {!data && loadError && (
        <button
          onClick={() =>
            void read().catch((e) =>
              setLoadError(
                e instanceof Error ? e.message : 'Chưa tải được ví thử.',
              ),
            )
          }
        >
          Thử tải ví lại
        </button>
      )}
      {data && (
        <>
          <div className="paper-toolbar">
            <label>
              Ví đầu tư thử
              <select
                aria-label="Ví đầu tư thử"
                disabled={busy || !!pending}
                value={wallet?.id ?? ''}
                onChange={(e) => changeWallet(e.target.value)}
              >
                {!data.wallets.length && <option value="">Chưa có ví</option>}
                {data.wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · vốn {money(w.initial_capital_vnd)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => void read().catch((e) => setError(String(e)))}
            >
              Làm mới ví
            </button>
          </div>
          {!wallet ? (
            <WalletForm
              locked={busy || !!pending}
              onCreated={(w) => changeWallet(w.id)}
            />
          ) : (
            <details className="paper-card">
              <summary>Tạo ví thử khác với số vốn mới</summary>
              <WalletForm
                locked={busy || !!pending}
                onCreated={(w) => changeWallet(w.id)}
              />
              <p>Lịch sử ví cũ được giữ nguyên. Tối đa 20 ví/tài khoản.</p>
            </details>
          )}
          {wallet && (
            <>
              <div className="paper-metrics">
                <div>
                  <span>Vốn ban đầu</span>
                  <strong>{money(wallet.initial_capital_vnd)}</strong>
                </div>
                <div>
                  <span>Tiền mặt còn lại</span>
                  <strong data-testid="paper-cash">
                    {money(wallet.cash_vnd)}
                  </strong>
                </div>
                <div>
                  <span>Tài sản theo giá tham khảo</span>
                  <strong data-testid="paper-nav">
                    {money(valuation?.nav_vnd)}
                  </strong>
                </div>
                <div>
                  <span>Lãi/lỗ tổng</span>
                  <strong data-testid="paper-profit">
                    {money(valuation?.profit_vnd)}
                  </strong>
                  <small>
                    {valuation?.profit_pct === null
                      ? 'Chưa đủ giá'
                      : num(valuation?.profit_pct ?? 0) + '%'}
                  </small>
                </div>
              </div>
              <div className="paper-layout">
                <section className="paper-card">
                  <h2>Thử một quyết định</h2>
                  <p>
                    Phí {num(wallet.fee_bps / 100)}% mỗi chiều; thuế bán{' '}
                    {num(wallet.tax_bps / 100)}% là giả định của ví này.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void getQuote();
                    }}
                  >
                    <div className="paper-form-grid">
                      <label>
                        Mã cổ phiếu
                        <input
                          aria-label="Mã cổ phiếu thử"
                          value={symbol}
                          maxLength={12}
                          pattern="[A-Z0-9]{3,12}"
                          required
                          disabled={busy || !!pending}
                          onChange={(e) => {
                            setSymbol(e.target.value.toUpperCase());
                            setQuote(null);
                          }}
                        />
                      </label>
                      <label>
                        Thao tác
                        <select
                          aria-label="Thao tác thử"
                          value={side}
                          disabled={busy || !!pending}
                          onChange={(e) =>
                            setSide(e.target.value as 'buy' | 'sell')
                          }
                        >
                          <option value="buy">Mua thử</option>
                          <option value="sell">Bán thử</option>
                        </select>
                      </label>
                      <label>
                        Số lượng cổ phiếu
                        <input
                          type="number"
                          aria-label="Số lượng cổ phiếu thử"
                          min="100"
                          max="1000000"
                          step="100"
                          required
                          value={Number.isFinite(quantity) ? quantity : ''}
                          disabled={busy || !!pending}
                          onChange={(e) => setQuantity(e.target.valueAsNumber)}
                        />
                      </label>
                      <label>
                        Cách lấy giá
                        <select
                          aria-label="Cách lấy giá thử"
                          value={mode}
                          disabled={busy || !!pending}
                          onChange={(e) => {
                            setMode(e.target.value as 'source' | 'cached');
                            setQuote(null);
                            setAccept(false);
                          }}
                        >
                          <option value="source">Đọc giá từ VPS</option>
                          <option value="cached">
                            Dùng giá đã lưu để luyện tập
                          </option>
                        </select>
                      </label>
                    </div>
                    <button disabled={busy || !!pending}>
                      {busy ? 'Đang xử lý…' : 'Lấy giá tham khảo'}
                    </button>
                  </form>
                  {quote && (
                    <div className="paper-preview" data-testid="paper-preview">
                      <h3>
                        {quote.symbol} · {money(quote.price_vnd)}
                      </h3>
                      <p>
                        {quote.mode === 'source'
                          ? 'Đọc từ VPS'
                          : 'Giá đã lưu, có thể cũ'}{' '}
                        · nhận lúc {formatTime(quote.observed_at)}
                        {quote.price_date
                          ? ' · bar ngày ' + quote.price_date
                          : ''}
                        . Chưa xác minh timestamp khớp/giá điều chỉnh. Xác nhận
                        trước {formatTime(quote.expires_at)}.
                      </p>
                      {estimate && (
                        <dl>
                          <div>
                            <dt>Giá trị cổ phiếu</dt>
                            <dd>{money(estimate.gross)}</dd>
                          </div>
                          <div>
                            <dt>Phí giả định</dt>
                            <dd>{money(estimate.fee)}</dd>
                          </div>
                          <div>
                            <dt>Thuế bán giả định</dt>
                            <dd>{money(estimate.tax)}</dd>
                          </div>
                          <div>
                            <dt>
                              {side === 'buy'
                                ? 'Tổng tiền trừ'
                                : 'Tiền nhận về'}
                            </dt>
                            <dd>{money(Math.abs(estimate.cashDelta))}</dd>
                          </div>
                        </dl>
                      )}
                      {quote.mode === 'cached' && (
                        <label className="paper-check">
                          <input
                            type="checkbox"
                            checked={accept}
                            disabled={busy || !!pending}
                            onChange={(e) => setAccept(e.target.checked)}
                          />
                          Tôi đồng ý luyện tập theo giá đã lưu, có thể đã cũ.
                        </label>
                      )}
                      {expired && (
                        <p role="status">
                          Giá xác nhận đã hết hạn. Lấy giá lại trước khi giao
                          dịch.
                        </p>
                      )}
                      {side === 'sell' && (
                        <p>
                          Đang giữ {num(held)} cổ phiếu {symbol}. Không bán vượt
                          số lượng.
                        </p>
                      )}
                      <button
                        disabled={!canOrder || busy || !!pending}
                        onClick={() => {
                          if (wallet && quote)
                            void execute({
                              walletId: wallet.id,
                              quoteId: quote.id,
                              side,
                              quantity,
                              requestId: crypto.randomUUID(),
                              acceptCached: accept,
                            });
                        }}
                      >
                        {side === 'buy'
                          ? 'Xác nhận mua thử'
                          : 'Xác nhận bán thử'}
                      </button>
                    </div>
                  )}
                  {pending && (
                    <div className="paper-notice">
                      <p>
                        Đang giữ nguyên yêu cầu để tránh ghi trùng. Nếu mạng
                        chậm, kiểm tra lịch sử hoặc thử lại cùng yêu cầu.
                      </p>
                      <button
                        disabled={busy}
                        onClick={() => void checkPending()}
                      >
                        Kiểm tra trạng thái giao dịch
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void execute(pending)}
                      >
                        Thử lại cùng yêu cầu
                      </button>
                    </div>
                  )}
                </section>
                <section className="paper-card">
                  <h2>Danh mục thử</h2>
                  {live.message && <p role="status">{live.message}</p>}
                  <p>
                    Lãi/lỗ đã chốt: {money(wallet.realized_vnd)} · chưa chốt:{' '}
                    {money(valuation?.unrealized_vnd)}. Giá vốn đã gồm phí mua.
                  </p>
                  <p>
                    Đủ giá tham khảo {valuation?.covered ?? 0}/
                    {valuation?.total ?? 0} mã. Giá cũ vẫn có dấu thời gian;
                    không coi đây là định giá trực tiếp theo sàn.
                  </p>
                  {!valuation?.rows.length ? (
                    <p>Chưa có cổ phiếu. Chọn mã và lấy giá để bắt đầu.</p>
                  ) : (
                    <div className="paper-table-scroll">
                      <table>
                        <caption>Chọn mã để lấy giá lại hoặc bán thử</caption>
                        <thead>
                          <tr>
                            <th>Mã</th>
                            <th>Số CP</th>
                            <th>Vốn còn lại</th>
                            <th>Giá tham khảo</th>
                            <th>Lãi/lỗ chưa chốt</th>
                            <th>Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {valuation.rows.map((p) => (
                            <tr key={p.stock_id}>
                              <th>
                                <Link href={'/stocks?symbol=' + p.symbol}>
                                  {p.symbol}
                                </Link>
                              </th>
                              <td>{num(p.quantity)}</td>
                              <td>
                                {money(p.cost_vnd)}
                                <small>TB {money(p.average_cost_vnd)}</small>
                              </td>
                              <td>
                                {money(p.mark?.price_vnd)}
                                <small>
                                  {p.mark
                                    ? formatTime(p.mark.observed_at)
                                    : 'Chưa có giá'}
                                </small>
                              </td>
                              <td>{money(p.unrealized_vnd)}</td>
                              <td>
                                <button
                                  disabled={busy || !!pending}
                                  onClick={() => {
                                    setSymbol(p.symbol);
                                    setSide('sell');
                                    setQuantity(100);
                                    setQuote(null);
                                  }}
                                >
                                  Chọn {p.symbol}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
              <section className="paper-card">
                <h2>Lịch sử mua/bán thử</h2>
                <div className="paper-table-scroll">
                  <table>
                    <caption>
                      Chỉ các giao dịch đã ghi nhận; không phải lệnh trên sàn
                    </caption>
                    <thead>
                      <tr>
                        <th>Thời điểm</th>
                        <th>Loại</th>
                        <th>Mã</th>
                        <th>Số CP</th>
                        <th>Giá</th>
                        <th>Phí / thuế</th>
                        <th>Lãi/lỗ đã chốt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trades.map((t) => (
                        <tr key={t.id} data-testid="paper-trade">
                          <td>{formatTime(t.created_at)}</td>
                          <td>{t.side === 'buy' ? 'Mua thử' : 'Bán thử'}</td>
                          <th>{t.symbol}</th>
                          <td>{num(t.quantity)}</td>
                          <td>{money(t.price_vnd)}</td>
                          <td>
                            {money(t.fee_vnd)} / {money(t.tax_vnd)}
                          </td>
                          <td>
                            {t.side === 'sell' ? money(t.realized_vnd) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.trades.length && (
                  <p>Chưa có giao dịch trong trang này.</p>
                )}
                <div className="paper-pagination">
                  <button disabled={!cursor} onClick={() => setCursor(null)}>
                    Giao dịch mới nhất
                  </button>
                  <button
                    disabled={!data.next}
                    onClick={() => setCursor(data.next)}
                  >
                    Giao dịch cũ hơn
                  </button>
                </div>
              </section>
            </>
          )}
        </>
      )}
      <p>Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</p>
    </div>
  );
}
function WalletForm({
  onCreated,
  locked,
}: {
  onCreated: (wallet: PaperWallet) => void;
  locked: boolean;
}) {
  const [name, setName] = useState('Ví trải nghiệm'),
    [capital, setCapital] = useState(100000000),
    [fee, setFee] = useState(0.15),
    [tax, setTax] = useState(0.1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function create() {
    if (busy || locked) return;
    setBusy(true);
    setError('');
    try {
      const r = await paperRequest<{ data: PaperWallet }>('/v1/paper/wallets', {
        name,
        capital,
        feeBps: Math.round(fee * 100),
        taxBps: Math.round(tax * 100),
        requestId,
      });
      setRequestId(crypto.randomUUID());
      onCreated(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được ví thử.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="paper-wallet-form">
      <h2>Bắt đầu với vốn ảo</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="paper-form-grid">
          <label>
            Tên ví thử
            <input
              required
              maxLength={80}
              value={name}
              disabled={busy || locked}
              onChange={(e) => {
                setName(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
            />
          </label>
          <label>
            Vốn ban đầu (VND)
            <input
              type="number"
              min="100000"
              max="1000000000000"
              step="1"
              required
              value={Number.isFinite(capital) ? capital : ''}
              disabled={busy || locked}
              onChange={(e) => {
                setCapital(e.target.valueAsNumber);
                setRequestId(crypto.randomUUID());
              }}
            />
          </label>
        </div>
        <p>
          {money(capital)} · đây là tiền ảo do bạn tự cấp, không nạp/rút tiền
          thật.
        </p>
        <details>
          <summary>Phí và thuế giả định</summary>
          <div className="paper-form-grid">
            <label>
              Phí mỗi chiều (%)
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                required
                disabled={busy || locked}
                value={Number.isFinite(fee) ? fee : ''}
                onChange={(e) => {
                  setFee(e.target.valueAsNumber);
                  setRequestId(crypto.randomUUID());
                }}
              />
            </label>
            <label>
              Thuế bán (%)
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                required
                disabled={busy || locked}
                value={Number.isFinite(tax) ? tax : ''}
                onChange={(e) => {
                  setTax(e.target.valueAsNumber);
                  setRequestId(crypto.randomUUID());
                }}
              />
            </label>
          </div>
          <p>
            Phí 0,15% và thuế 0,1% là giả định để luyện tập, không xác nhận biểu
            phí/nghĩa vụ thuế của bạn.
          </p>
        </details>
        <button disabled={busy || locked}>
          {busy ? 'Đang tạo…' : 'Tạo ví và cấp vốn ảo'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
