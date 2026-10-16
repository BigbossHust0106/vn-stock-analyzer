'use client';
import { useLivePrices } from './use-live-prices';
import { pollVisible } from '../lib/polling';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { settingsClient } from '../lib/scoring-settings';
import { formatNumber, formatTime, horizonLabels } from '../lib/rankings';
import { priceChange, type Horizon } from '../../modules/scoring/rankings';
interface List {
  id: string;
  name: string;
}
interface Item {
  stock_id: string;
  symbol: string;
  name: string;
  notes: string;
  target_price_vnd: number | null;
  price_vnd: number | null;
  reference_vnd: number | null;
  quote_fetched_at: string | null;
  score: number | null;
  previous_score: number | null;
  score_as_of: string | null;
  previous_as_of: string | null;
  explanation: { quoteSource?: string };
}
function WatchItem({
  item,
  listId,
  onChanged,
}: {
  item: Item;
  listId: string;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState(item.notes),
    [target, setTarget] = useState(item.target_price_vnd?.toString() ?? ''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const change = priceChange(item.price_vnd, item.reference_vnd),
    delta =
      item.score !== null && item.previous_score !== null
        ? item.score - item.previous_score
        : null;
  async function save(remove = false) {
    setBusy(true);
    setMessage('');
    try {
      const db = await settingsClient();
      const value = target.trim() === '' ? null : Number(target);
      if (
        !remove &&
        value !== null &&
        (!Number.isFinite(value) || value <= 0 || value >= 1e12)
      )
        throw new Error(
          'Giá mua mục tiêu phải lớn hơn 0 và nhỏ hơn 1.000 tỷ đồng.',
        );
      const result = remove
        ? await db
            .from('watchlist_items')
            .delete()
            .eq('watchlist_id', listId)
            .eq('stock_id', item.stock_id)
            .select('stock_id')
        : await db
            .from('watchlist_items')
            .update({
              notes,
              target_price_vnd: value,
              updated_at: new Date().toISOString(),
            })
            .eq('watchlist_id', listId)
            .eq('stock_id', item.stock_id)
            .select('stock_id');
      if (result.error || result.data?.length !== 1)
        throw new Error('Không lưu được; phiên hoặc danh sách đã thay đổi.');
      setMessage('Đã lưu.');
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="watch-card" data-testid={'watch-' + item.symbol}>
      <div className="section-heading">
        <div>
          <h3>
            <Link href={'/stocks?symbol=' + item.symbol}>{item.symbol}</Link>
          </h3>
          <p>{item.name}</p>
        </div>
        <button disabled={busy} onClick={() => void save(true)}>
          Xóa {item.symbol}
        </button>
      </div>
      <div className="watch-metrics">
        <div>
          <small>
            {item.price_vnd === null
              ? 'Giá tham chiếu; chưa có giá giao dịch cập nhật'
              : 'Giá hiện tại'}
          </small>
          <strong>
            {formatNumber(item.price_vnd ?? item.reference_vnd)} đ
          </strong>
          <span
            className={change !== null && change >= 0 ? 'positive' : 'negative'}
          >
            {change !== null && change > 0 ? '+' : ''}
            {formatNumber(change, 2)}%
          </span>
        </div>
        <div>
          <small>Điểm hiện tại · {item.score_as_of ?? 'chưa có'}</small>
          <strong>{formatNumber(item.score, 1)} /100</strong>
          <span>
            {delta === null
              ? 'Chưa có điểm lần trước'
              : `${delta > 0 ? '+' : ''}${formatNumber(delta, 1)} so với ${item.previous_as_of}`}
          </span>
        </div>
      </div>
      <small>
        {item.explanation?.quoteSource ?? 'VPS'} · Giá nhận lúc{' '}
        {formatTime(item.quote_fetched_at)}
      </small>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Ghi chú {item.symbol}
          <textarea
            aria-label={'Ghi chú ' + item.symbol}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label>
          Giá mua mục tiêu {item.symbol} (đồng)
          <input
            aria-label={'Giá mua mục tiêu ' + item.symbol + ' (đồng)'}
            type="number"
            min="0.000001"
            max="999999999999"
            step="any"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <button disabled={busy}>Lưu {item.symbol}</button>
      </form>
      <p role="status">{message}</p>
    </article>
  );
}
export function Watchlists() {
  const [lists, setLists] = useState<List[]>([]),
    [selected, setSelected] = useState(''),
    [items, setItems] = useState<Item[]>([]),
    [horizon, setHorizon] = useState<Horizon>('quarter'),
    [name, setName] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [symbol, setSymbol] = useState(''),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [loadedKey, setLoadedKey] = useState(''),
    [rename, setRename] = useState('');
  const live = useLivePrices(
    loadedKey === selected + horizon ? items.map((item) => item.symbol) : [],
  );
  useEffect(() => {
    let stopped = false;
    void settingsClient()
      .then(async (db) => {
        const { data, error } = await db
          .from('watchlists')
          .select('id,name')
          .order('created_at');
        if (stopped) return;
        if (error) {
          setMessage('Không tải được danh sách.');
          return;
        }
        setLists(data ?? []);
        setSelected((current) =>
          data?.some((l) => l.id === current) ? current : (data?.[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (!stopped) setMessage('Không tải được danh sách.');
      });
    return () => {
      stopped = true;
    };
  }, [revision]);
  useEffect(() => {
    let stopped = false,
      pending = false;

    async function load() {
      if (!selected || pending) return;
      pending = true;
      try {
        const db = await settingsClient();
        const { data, error } = await db.rpc('watchlist_snapshot', {
          list_id: selected,
          period: horizon,
        });
        if (stopped) return;
        if (error) throw new Error('Không đọc được giá/điểm theo dõi.');
        setItems((data ?? []) as Item[]);
        setLoadedKey(selected + horizon);
      } catch (e) {
        if (!stopped)
          setMessage(
            e instanceof Error ? e.message : 'Không đọc được dữ liệu.',
          );
      } finally {
        pending = false;
        if (!stopped) setLoading(false);
      }
    }
    const stop = pollVisible(load, 60000);
    return () => {
      stopped = true;
      stop();
    };
  }, [selected, horizon, revision]);
  async function mutate(action: 'create' | 'rename' | 'delete' | 'add') {
    setBusy(true);
    setMessage('');
    try {
      const db = await settingsClient();
      if (action === 'create') {
        if (!name.trim()) throw new Error('Nhập tên danh sách.');
        const { data, error } = await db
          .from('watchlists')
          .insert({ name: name.trim() })
          .select('id')
          .single();
        if (error || !data)
          throw new Error('Không tạo được danh sách; tên có thể đã tồn tại.');
        setSelected(data.id);
        setName('');
      }
      if (action === 'rename') {
        if (!rename.trim()) throw new Error('Nhập tên mới.');
        const { data, error } = await db
          .from('watchlists')
          .update({ name: rename.trim() })
          .eq('id', selected)
          .select('id');
        if (error || data?.length !== 1)
          throw new Error('Không đổi được tên danh sách.');
        setRename('');
      }
      if (action === 'delete') {
        const { data, error } = await db
          .from('watchlists')
          .delete()
          .eq('id', selected)
          .select('id');
        if (error || data?.length !== 1)
          throw new Error('Không xóa được danh sách.');
        setSelected('');
      }
      if (action === 'add') {
        const code = symbol.trim().toUpperCase();
        if (!/^[A-Z0-9]{3,12}$/.test(code))
          throw new Error('Mã chứng khoán không hợp lệ.');
        const { data: stock, error: readError } = await db
          .from('stocks')
          .select('id')
          .eq('symbol', code)
          .eq('active', true)
          .maybeSingle();
        if (readError || !stock)
          throw new Error('Không tìm thấy mã trên HOSE/HNX/UPCOM.');
        const { error } = await db
          .from('watchlist_items')
          .upsert(
            { watchlist_id: selected, stock_id: stock.id },
            { onConflict: 'watchlist_id,stock_id', ignoreDuplicates: true },
          );
        if (error) throw new Error('Không thêm được mã.');
        setSymbol('');
      }
      setRevision((v) => v + 1);
      setMessage('Đã lưu thay đổi.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không lưu được thay đổi.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="phase4-page">
      <span className="eyebrow">DANH MỤC CỦA BẠN</span>
      <h1>Danh sách theo dõi</h1>
      <p>
        <Link href="/alerts">Thiết lập cảnh báo & xem thông báo ↗</Link>
      </p>
      <p>
        Giá được làm mới mỗi 30 giây. Chênh lệch điểm so với phiên xếp hạng
        trước; nếu chưa có điểm cũ sẽ hiển thị rõ.
      </p>
      <div className="watch-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate('create');
          }}
        >
          <label>
            Tên danh sách mới
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button disabled={busy}>Tạo danh sách</button>
        </form>
        {lists.length > 0 && (
          <>
            <label>
              Danh sách của bạn
              <select
                aria-label="Danh sách của bạn"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Khung điểm
              <select
                aria-label="Khung điểm"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as Horizon)}
              >
                {Object.entries(horizonLabels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {selected && (
        <>
          <div className="action-row">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate('rename');
              }}
            >
              <label>
                Tên mới
                <input
                  maxLength={120}
                  required
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
              </label>
              <button disabled={busy}>Đổi tên</button>
            </form>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Xóa danh sách này và các mã theo dõi bên trong?',
                  )
                )
                  void mutate('delete');
              }}
            >
              Xóa danh sách
            </button>
          </div>
          <form
            className="action-row"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('add');
            }}
          >
            <label>
              Mã chứng khoán
              <input
                required
                maxLength={12}
                placeholder="Ví dụ: VNM"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            </label>
            <button disabled={busy}>Thêm mã</button>
          </form>
        </>
      )}
      <p role="status">{message}</p>
      {selected && (loading || loadedKey !== selected + horizon) && (
        <p>Đang tải giá và điểm…</p>
      )}
      {!loading &&
        loadedKey === selected + horizon &&
        selected &&
        !items.length && (
          <p>
            Danh sách chưa có mã. Thêm mã tại đây hoặc từ{' '}
            <Link href="/top10">Top 10</Link>.
          </p>
        )}
      {!lists.length && (
        <p>Tạo danh sách đầu tiên để bắt đầu theo dõi cổ phiếu.</p>
      )}
      {live.message && <p className="data-timestamp">{live.message}</p>}
      <div className="watch-grid">
        {(loadedKey === selected + horizon ? items : []).map((item) => (
          <WatchItem
            key={selected + item.stock_id}
            item={
              live.prices[item.symbol]
                ? {
                    ...item,
                    price_vnd: live.prices[item.symbol]!.last_price_vnd,
                    reference_vnd: live.prices[item.symbol]!.reference_vnd,
                    quote_fetched_at: live.prices[item.symbol]!.fetched_at,
                    explanation: {
                      ...item.explanation,
                      quoteSource: 'VPS · snapshot',
                    },
                  }
                : item
            }
            listId={selected}
            onChanged={() => setRevision((v) => v + 1)}
          />
        ))}
      </div>
    </div>
  );
}
