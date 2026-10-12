export interface CurrentQuote {
  symbol: string;
  referenceVnd: number;
  ceilingVnd: number;
  floorVnd: number;
  lastPriceVnd: number | null;
  bid3PriceVnd: number | null;
  volumeRaw: {
    lastVolume: number;
    lot: number;
    lastVolumeUnit: 'unverified';
    lotUnit: 'lot_of_10_shares';
  };
  totalVolumeShares: number;
  volumeVerificationScope: 'ACB_2026-10-12_only';
  marketCodeRaw: string;
  fetchedAt: string;
  exchangeTimestamp: null;
  priceBasis: 'unverified';
  semantics: {
    lastPrice: 'verified_on_acb_one_day' | 'inferred_from_field_name';
    bid3: 'user_verified_for_acb' | 'inferred_from_acb_contract';
  };
}
export interface DataProvider {
  fetchQuotes(symbols: readonly string[]): Promise<CurrentQuote[]>;
}
