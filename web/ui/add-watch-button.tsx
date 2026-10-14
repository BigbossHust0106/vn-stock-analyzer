'use client';
import { useState } from 'react';
import { settingsClient } from '../lib/scoring-settings';
import { useAuth } from './auth-provider';
function AddWatchControl({
  stockId,
  symbol,
}: {
  stockId: string;
  symbol: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false),
    [lists, setLists] = useState<{ id: string; name: string }[]>([]),
    [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function show() {
    if (!user) {
      window.location.assign('/login?next=/top10');
      return;
    }
    setOpen(true);
    setBusy(true);
    setMessage('');
    try {
      const db = await settingsClient();
      const { data, error } = await db
        .from('watchlists')
        .select('id,name')
        .order('created_at');
      if (error) throw new Error('Không đọc được danh sách.');
      setLists(data ?? []);
      setSelected(data?.[0]?.id ?? '');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không đọc được danh sách.');
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!user) return;
    setBusy(true);
    setMessage('');
    try {
      const db = await settingsClient();
      let id = selected;
      if (!id) {
        if (!name.trim()) throw new Error('Nhập tên danh sách mới.');
        const { data, error } = await db
          .from('watchlists')
          .insert({ name: name.trim() })
          .select('id')
          .single();
        if (error || !data)
          throw new Error('Không tạo được danh sách; tên có thể đã tồn tại.');
        id = data.id;
        setSelected(id);
        setLists([...lists, { id, name: name.trim() }]);
      }
      const { error } = await db
        .from('watchlist_items')
        .upsert(
          { watchlist_id: id, stock_id: stockId },
          { onConflict: 'watchlist_id,stock_id', ignoreDuplicates: true },
        );
      if (error) throw new Error('Không thêm được mã vào theo dõi.');
      setMessage('Đã thêm ' + symbol + ' vào danh sách.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không thêm được mã.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={() => void show()} aria-label={'Theo dõi ' + symbol}>
        + Theo dõi
      </button>
      {open && (
        <div className="dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={'Theo dõi ' + symbol}
            className="watch-dialog"
          >
            <h2>Theo dõi {symbol}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <label>
                Danh sách
                <select
                  aria-label="Danh sách"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Tạo danh sách mới</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              {!selected && (
                <label>
                  Tên danh sách
                  <input
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <button disabled={busy}>Thêm vào danh sách</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Đóng
              </button>
            </form>
            <p role="status">{message}</p>
            <a href="/watchlists">Mở danh sách theo dõi</a>
          </section>
        </div>
      )}
    </>
  );
}

export function AddWatchButton(props: { stockId: string; symbol: string }) {
  const { user } = useAuth();
  return <AddWatchControl key={user?.id ?? 'guest'} {...props} />;
}
