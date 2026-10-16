import { describe, expect, it } from 'vitest';
import {
  estimateOrder,
  portfolioValue,
  type PaperWallet,
  type PaperPosition,
} from '../../modules/paper/accounting';
const wallet: PaperWallet = {
  id: 'w',
  name: 'Ví',
  initial_capital_vnd: 100000000,
  cash_vnd: 97282750,
  realized_vnd: 287250,
  fee_bps: 15,
  tax_bps: 10,
  created_at: '2026-10-16T00:00:00Z',
};
const position: PaperPosition = {
  stock_id: 's',
  symbol: 'FPT',
  name: 'FPT',
  quantity: 100,
  cost_vnd: 3004500,
  mark: {
    price_vnd: 33000,
    observed_at: '2026-10-16T00:00:00Z',
    mode: 'cached',
    price_date: null,
  },
};
describe('paper accounting in VND, not thousand VND', () => {
  it('calculates fees and tax by hand, with ceil to one VND', () => {
    // 100*30,000=3m; fee=4,500. Sell100*33,000: fee4,950 tax3,300 net3,291,750.
    expect(estimateOrder(30000, 100, 15, 10, 'buy')).toEqual({
      gross: 3000000,
      fee: 4500,
      tax: 0,
      cashDelta: -3004500,
    });
    expect(estimateOrder(33000, 100, 15, 10, 'sell')).toEqual({
      gross: 3300000,
      fee: 4950,
      tax: 3300,
      cashDelta: 3291750,
    });
    // 3,735,000*0.0015=5,602.5 =>5,603; tax3,735; net3,725,662.
    expect(estimateOrder(37350, 100, 15, 10, 'sell')).toEqual({
      gross: 3735000,
      fee: 5603,
      tax: 3735,
      cashDelta: 3725662,
    });
    expect(estimateOrder(30000, 100, 0, 0, 'buy')?.fee).toBe(0);
  });
  it('preserves integer precision for large allowed orders', () => {
    // 999,999,999*1m=999,999,999,000,000; 1%=9,999,999,990,000 exactly.
    expect(estimateOrder(999999999, 1000000, 100, 100, 'sell')).toEqual({
      gross: 999999999000000,
      fee: 9999999990000,
      tax: 9999999990000,
      cashDelta: 979999999020000,
    });
  });
  it('rejects invalid prices, lots and rates', () => {
    for (const p of [0, -1, NaN, Infinity, 1e9, 30.5])
      expect(estimateOrder(p, 100, 15, 10, 'buy')).toBeNull();
    for (const q of [0, -100, 150, 1000001, NaN])
      expect(estimateOrder(30000, q, 15, 10, 'buy')).toBeNull();
    for (const b of [-1, 101, 0.5, NaN]) {
      expect(estimateOrder(30000, 100, b, 10, 'buy')).toBeNull();
      expect(estimateOrder(30000, 100, 15, b, 'sell')).toBeNull();
    }
    expect(estimateOrder(30000, 100, 15, 10, 'invalid' as 'buy')).toBeNull();
  });
  it('values partial sale from manually calculated remaining cost', () => {
    // Buy200 cost6,009,000; sell100 realizes287,250; remaining cost3,004,500.
    // Remaining value3.3m; unrealized295,500; NAV97,282,750+3.3m=100,582,750.
    const v = portfolioValue(wallet, [position]);
    expect(v.nav_vnd).toBe(100582750);
    expect(v.profit_vnd).toBe(582750);
    expect(v.profit_pct).toBeCloseTo(0.58275);
    expect(v.unrealized_vnd).toBe(295500);
    expect(v.rows[0]?.average_cost_vnd).toBe(30045);
    expect(v.profit_vnd).toBe(wallet.realized_vnd + v.unrealized_vnd!);
  });
  it('does not turn missing prices into zero portfolio value', () => {
    const v = portfolioValue(wallet, [position, { ...position, mark: null }]);
    expect(v.covered).toBe(1);
    expect(v.total).toBe(2);
    expect(v.nav_vnd).toBeNull();
    expect(v.profit_pct).toBeNull();
    expect(v.unrealized_vnd).toBeNull();
    expect(
      portfolioValue({ ...wallet, cash_vnd: 100000000 }, []).profit_vnd,
    ).toBe(0);
  });
  it('rejects invalid positions, unsafe values and wallet balances without NaN', () => {
    for (const p of [
      { ...position, quantity: 0 },
      { ...position, cost_vnd: -1 },
      { ...position, mark: { ...position.mark!, price_vnd: NaN } },
      {
        ...position,
        quantity: 1e9,
        mark: { ...position.mark!, price_vnd: 1e9 },
      },
    ])
      expect(portfolioValue(wallet, [p]).nav_vnd).toBeNull();
    expect(
      portfolioValue(wallet, [{ ...position, quantity: 0 }]).rows[0]
        ?.average_cost_vnd,
    ).toBeNull();
    for (const w of [
      { ...wallet, cash_vnd: -1 },
      { ...wallet, initial_capital_vnd: 0 },
      { ...wallet, cash_vnd: NaN },
    ])
      expect(portfolioValue(w, [position]).profit_pct).toBeNull();
  });
});
