'use client';
import { useEffect, useState } from 'react';
import { marketJson } from '../lib/market-client';
import { pollVisible } from '../lib/polling';
import { mergePriceSnapshots, type LivePrice } from '../lib/live-prices';
export function useLivePrices(symbols: string[]): {
  prices: Record<string, LivePrice>;
  message: string;
} {
  const key = [...new Set(symbols)].sort().join(',');
  const [state, setState] = useState<{
    key: string;
    prices: Record<string, LivePrice>;
    message: string;
  }>({ key: '', prices: {}, message: '' });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const stop = pollVisible(async () => {
      try {
        const prices: Record<string, LivePrice> = {};
        let failed = false;
        const wanted = key.split(',');
        for (let i = 0; i < wanted.length; i += 50) {
          const body = (await marketJson(
            '/v1/quotes?symbols=' + wanted.slice(i, i + 50).join(','),
            controller.signal,
            'no-store',
          )) as {
            data: { symbol: string; prices_current: LivePrice | null }[];
            refresh: { state: string };
          };
          if (!Array.isArray(body.data)) throw Error('Giá không hợp lệ.');
          failed ||= body.refresh?.state !== 'source_response';
          for (const row of body.data)
            if (row.prices_current) {
              const q = row.prices_current;
              if (
                wanted.includes(row.symbol) &&
                Number.isFinite(q.reference_vnd) &&
                q.reference_vnd > 0 &&
                (q.last_price_vnd === null ||
                  (Number.isFinite(q.last_price_vnd) &&
                    q.last_price_vnd > 0)) &&
                Number.isFinite(Date.parse(q.fetched_at))
              )
                prices[row.symbol] = q;
            }
        }
        if (!controller.signal.aborted)
          setState((previous) => ({
            key,
            prices: mergePriceSnapshots(
              previous.key === key ? previous.prices : {},
              prices,
            ),
            message: failed
              ? 'Nguồn giá tạm gián đoạn; đang giữ snapshot cũ, sẽ tự thử lại.'
              : 'Tự lấy giá mỗi 10 giây khi trang đang mở; thời điểm nhận không phải timestamp sàn.',
          }));
      } catch {
        if (!controller.signal.aborted)
          setState((previous) => ({
            key,
            prices: previous.key === key ? previous.prices : {},
            message:
              'Chưa cập nhật được giá; đang giữ dữ liệu cũ và sẽ tự thử lại.',
          }));
      }
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [key]);
  return state.key === key ? state : { prices: {}, message: '' };
}
