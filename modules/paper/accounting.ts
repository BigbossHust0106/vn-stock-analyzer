export interface PaperWallet {
  id: string;
  name: string;
  initial_capital_vnd: number;
  cash_vnd: number;
  realized_vnd: number;
  fee_bps: number;
  tax_bps: number;
  created_at: string;
}
export interface PaperQuote {
  id: string;
  stock_id: string;
  symbol: string;
  price_vnd: number;
  observed_at: string;
  expires_at: string;
  mode: 'source' | 'cached';
  price_date: string | null;
}
export interface PaperPosition {
  stock_id: string;
  symbol: string;
  name: string;
  quantity: number;
  cost_vnd: number;
  mark: {
    price_vnd: number;
    observed_at: string;
    mode: string;
    price_date: string | null;
  } | null;
}
export interface PaperTrade {
  id: string;
  wallet_id: string;
  request_id: string;
  quote_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price_vnd: number;
  gross_vnd: number;
  fee_vnd: number;
  tax_vnd: number;
  realized_vnd: number;
  created_at: string;
}
export function estimateOrder(
  price: number,
  quantity: number,
  feeBps: number,
  taxBps: number,
  side: 'buy' | 'sell',
) {
  if (
    !Number.isSafeInteger(price) ||
    price <= 0 ||
    price >= 1e9 ||
    !Number.isInteger(quantity) ||
    quantity < 100 ||
    quantity > 1e6 ||
    quantity % 100 !== 0 ||
    ![feeBps, taxBps].every((x) => Number.isInteger(x) && x >= 0 && x <= 100) ||
    !['buy', 'sell'].includes(side)
  )
    return null;
  const gross = price * quantity,
    fee = Number((BigInt(gross) * BigInt(feeBps) + 9999n) / 10000n),
    tax =
      side === 'sell'
        ? Number((BigInt(gross) * BigInt(taxBps) + 9999n) / 10000n)
        : 0;
  const cashDelta = side === 'buy' ? -(gross + fee) : gross - fee - tax;
  if (![gross, fee, tax, cashDelta].every(Number.isSafeInteger)) return null;
  return { gross, fee, tax, cashDelta };
}
export function portfolioValue(
  wallet: PaperWallet,
  positions: PaperPosition[],
) {
  const rows = positions.map((p) => {
    const valid =
      Number.isSafeInteger(p.quantity) &&
      p.quantity > 0 &&
      Number.isSafeInteger(p.cost_vnd) &&
      p.cost_vnd >= 0;
    const candidate =
      valid &&
      p.mark &&
      Number.isSafeInteger(p.mark.price_vnd) &&
      p.mark.price_vnd > 0
        ? p.mark.price_vnd * p.quantity
        : null;
    const value =
      candidate !== null && Number.isSafeInteger(candidate) ? candidate : null;
    return {
      ...p,
      value_vnd: value,
      average_cost_vnd: valid ? p.cost_vnd / p.quantity : null,
      unrealized_vnd: value === null ? null : value - p.cost_vnd,
    };
  });
  const covered = rows.filter((p) => p.value_vnd !== null).length;
  const sum = rows.reduce((a, p) => a + (p.value_vnd ?? 0), 0);
  const nav =
    Number.isSafeInteger(wallet.cash_vnd) &&
    wallet.cash_vnd >= 0 &&
    Number.isSafeInteger(wallet.initial_capital_vnd) &&
    wallet.initial_capital_vnd > 0 &&
    covered === rows.length &&
    Number.isSafeInteger(sum + wallet.cash_vnd)
      ? sum + wallet.cash_vnd
      : null;
  const profit = nav === null ? null : nav - wallet.initial_capital_vnd;
  const unrealized = rows.reduce((a, p) => a + (p.unrealized_vnd ?? 0), 0);
  return {
    rows,
    covered,
    total: rows.length,
    nav_vnd: nav,
    profit_vnd: profit,
    profit_pct:
      profit === null || wallet.initial_capital_vnd <= 0
        ? null
        : (profit / wallet.initial_capital_vnd) * 100,
    unrealized_vnd:
      nav !== null && Number.isSafeInteger(unrealized) ? unrealized : null,
  };
}
