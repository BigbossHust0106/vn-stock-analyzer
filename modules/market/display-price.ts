import { vietnamDate } from './calendar';
import { validSourceDate } from '../providers/source-evidence';
import type { CurrentQuote } from '../providers/data-provider';
export interface DisplayPrice {
  valueVnd: number | null;
  kind: 'quote' | 'close' | 'unavailable';
  sessionDate: string | null;
  source: string;
}
export interface PreviousClose {
  sessionDate: string;
  closeVnd: number;
  source: string;
}
// Display-only fallback. Never turn a close/reference into a live quote or source timestamp.
export function displayPrice(
  quote: CurrentQuote | null,
  close: PreviousClose | null,
  now = Date.now(),
): DisplayPrice {
  const today = vietnamDate(now);
  const validClose =
    close &&
    validSourceDate(close.sessionDate) &&
    close.sessionDate < today &&
    Number.isFinite(close.closeVnd) &&
    close.closeVnd > 0;
  const validQuote =
    quote?.lastPriceVnd != null &&
    Number.isFinite(quote.lastPriceVnd) &&
    quote.lastPriceVnd > 0;
  const downloaded = quote ? Date.parse(quote.fetchedAt) : NaN;
  const downloadedToday =
    Number.isFinite(downloaded) && vietnamDate(downloaded) === today;
  // Conservative pre-open display; this clock boundary does not certify an open session.
  const beforeRegularOpen = new Date(now + 7 * 3600000).getUTCHours() < 9;
  if (validClose && beforeRegularOpen)
    return {
      valueVnd: close.closeVnd,
      kind: 'close',
      sessionDate: close.sessionDate,
      source: close.source,
    };
  if (validQuote && (downloadedToday || !validClose))
    return {
      valueVnd: quote!.lastPriceVnd,
      kind: 'quote',
      sessionDate: null,
      source: 'VPS · snapshot',
    };
  if (validClose)
    return {
      valueVnd: close.closeVnd,
      kind: 'close',
      sessionDate: close.sessionDate,
      source: close.source,
    };
  return { valueVnd: null, kind: 'unavailable', sessionDate: null, source: '' };
}
