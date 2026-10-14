'use client';
import { useCallback, useSyncExternalStore } from 'react';
import {
  defaultTradeSettings,
  validTradeSettings,
  type TradePlanSettings,
} from '../../modules/settings/trade-plan-settings';
const event = 'vn-stock-trade-settings';
const cache = new Map<
  string,
  { raw: string | null; value: TradePlanSettings }
>();
function snapshot(key: string) {
  try {
    const raw = localStorage.getItem(key),
      previous = cache.get(key);
    if (previous?.raw === raw) return previous.value;
    const parsed: unknown = JSON.parse(raw ?? 'null');
    const value = validTradeSettings(parsed) ? parsed : defaultTradeSettings;
    cache.set(key, { raw, value });
    return value;
  } catch {
    return defaultTradeSettings;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener('storage', callback);
  };
}
export function useTradeSettings(owner: string, symbol: string) {
  const key = 'vn-stock-trade-plan-v1:' + owner + ':' + symbol;
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(key),
    () => defaultTradeSettings,
  );
  const save = useCallback(
    (next: TradePlanSettings) => {
      if (!validTradeSettings(next)) return false;
      try {
        localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new Event(event));
        return true;
      } catch {
        return false;
      }
    },
    [key],
  );
  return { value, save };
}
