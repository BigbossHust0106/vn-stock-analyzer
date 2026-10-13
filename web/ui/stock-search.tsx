'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { searchStocks, type MarketStock } from '../lib/market-client';
export function StockSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [exchange, setExchange] = useState('');
  const [results, setResults] = useState<MarketStock[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const found = await searchStocks(query, exchange, controller.signal);
        if (!controller.signal.aborted) setResults(found);
      } catch (e) {
        if (!controller.signal.aborted) {
          setResults([]);
          setError(e instanceof Error ? e.message : 'Không tải được danh mục.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, exchange]);
  return (
    <section className="search-section">
      <label htmlFor="stock-query">Tìm mã hoặc tên công ty</label>
      <div className="search-controls">
        <input
          id="stock-query"
          type="search"
          value={query}
          onChange={(e) => {
            setResults([]);
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const candidate = query.trim().toUpperCase();
              const symbol =
                results.find((s) => s.symbol === candidate)?.symbol ??
                results[0]?.symbol ??
                (/^[A-Z0-9]{3,12}$/.test(candidate) ? candidate : undefined);
              if (symbol)
                router.push('/stocks?symbol=' + encodeURIComponent(symbol));
            }
          }}
          placeholder="VNM, FPT, HPG hoặc tên công ty…"
          maxLength={80}
          aria-controls="stock-suggestions"
          autoComplete="off"
        />
        <select
          aria-label="Lọc theo sàn"
          value={exchange}
          onChange={(e) => {
            setResults([]);
            setExchange(e.target.value);
          }}
        >
          <option value="">Tất cả sàn</option>
          {['HOSE', 'HNX', 'UPCOM'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="search-hint" aria-live="polite">
        {loading
          ? 'Đang tìm…'
          : error ||
            (query && !results.length
              ? 'Không tìm thấy mã phù hợp.'
              : 'Danh mục thật · HOSE / HNX / UPCOM')}
      </div>
      <ul id="stock-suggestions" className="stock-results">
        {results.map((s) => (
          <li key={s.symbol}>
            <Link href={'/stocks?symbol=' + s.symbol}>
              <span className="ticker">{s.symbol}</span>
              <span className="company-name">{s.name}</span>
              <span className="exchange-tag">{s.exchange}</span>
              <span aria-hidden="true">↗</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="quick-links">
        <span>Tra cứu nhanh</span>
        {['VNM', 'FPT', 'HPG'].map((s) => (
          <Link key={s} href={'/stocks?symbol=' + s}>
            {s} ↗
          </Link>
        ))}
      </div>
    </section>
  );
}
