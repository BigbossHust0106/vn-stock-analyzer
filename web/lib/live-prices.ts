export interface LivePrice {
  last_price_vnd: number | null;
  reference_vnd: number;
  fetched_at: string;
}
// A failed persistence followed by a DB fallback must not roll the UI back to an older sample.
export function mergePriceSnapshots(
  previous: Record<string, LivePrice>,
  incoming: Record<string, LivePrice>,
) {
  const prices = { ...previous };
  for (const [symbol, quote] of Object.entries(incoming))
    if (
      !prices[symbol] ||
      Date.parse(quote.fetched_at) >= Date.parse(prices[symbol].fetched_at)
    )
      prices[symbol] = quote;
  return prices;
}
