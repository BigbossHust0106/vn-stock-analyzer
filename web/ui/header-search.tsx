'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { searchStocks, type MarketStock } from '../lib/market-client';
export function HeaderSearch() {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<MarketStock[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    if (!query.trim() || !open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void searchStocks(query, '', controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) {
            setResults(rows);
            setError('');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
            setError(
              'Không tải được gợi ý. Bạn vẫn có thể nhập mã và nhấn Enter.',
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);
  function go(symbol: string) {
    setOpen(false);
    setQuery('');
    setResults([]);
    router.push('/stocks?symbol=' + encodeURIComponent(symbol));
  }
  return (
    <div className="header-search" ref={root}>
      <span aria-hidden="true" className="header-search-icon">
        ⌕
      </span>
      <input
        id="header-stock-query"
        type="search"
        aria-label="Tìm mã hoặc tên công ty"
        placeholder="Tìm mã hoặc công ty…"
        autoComplete="off"
        maxLength={80}
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!query.trim()}
        aria-controls="stock-suggestions"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setResults([]);
          setError('');
          setLoading(true);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter') {
            e.preventDefault();
            const candidate = query.trim().toUpperCase();
            const exact = results.find((s) => s.symbol === candidate);
            const symbol =
              exact?.symbol ??
              results[0]?.symbol ??
              (/^[A-Z0-9]{3,12}$/.test(candidate) ? candidate : null);
            if (symbol) go(symbol);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            root.current
              ?.querySelector<HTMLAnchorElement>('#stock-suggestions a')
              ?.focus();
          }
        }}
      />
      {open && !!query.trim() && (
        <div
          className="header-search-popover"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              root.current?.querySelector('input')?.focus();
            }
          }}
        >
          <ul
            role="listbox"
            id="stock-suggestions"
            className="stock-results"
            aria-label="Gợi ý mã"
          >
            {results.map((s) => (
              <li key={s.symbol} role="none">
                <Link
                  role="option"
                  aria-selected={false}
                  href={'/stocks?symbol=' + s.symbol}
                  onClick={() => {
                    setOpen(false);
                    setQuery('');
                    setResults([]);
                  }}
                >
                  <span className="ticker">{s.symbol}</span>
                  <span className="company-name">{s.name}</span>
                  <span className="exchange-tag">{s.exchange}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p role="status">
            {loading && !results.length
              ? 'Đang tìm…'
              : error ||
                (!results.length
                  ? 'Không có kết quả phù hợp.'
                  : 'Nhấn Enter hoặc chọn mã để mở chi tiết.')}
          </p>
        </div>
      )}
    </div>
  );
}
