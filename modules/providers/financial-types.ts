export interface AnnualFinancials {
  year: number;
  periodEnd: string;
  publishedAt: string;
  audited: boolean;
  consolidated: boolean;
  revenueVnd: number | null;
  netProfitVnd: number | null;
  parentProfitVnd: number | null;
  epsAnnualVnd: number | null;
  bvpsVnd: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  currentAssetsVnd: number | null;
  currentLiabilitiesVnd: number | null;
  longTermLiabilitiesVnd: number | null;
  equityVnd: number | null;
  minorityEquityVnd: number | null;
  operatingCashFlowVnd: number | null;
  capexVnd: number | null;
  freeCashFlowVnd: number | null;
  dividendsPaidVnd: number | null;
  sharesOutstanding: number | null;
}
export interface FinancialData {
  symbol: string;
  source: 'KBS_VIETCAP';
  fetchedAt: string;
  verification: 'provider_reported';
  businessType: number;
  supported: boolean;
  currentShares: number | null;
  annual: AnnualFinancials[];
  notices: string[];
}

const numericFields = [
  'revenueVnd',
  'netProfitVnd',
  'parentProfitVnd',
  'epsAnnualVnd',
  'bvpsVnd',
  'roe',
  'roa',
  'roic',
  'grossMargin',
  'netMargin',
  'debtToEquity',
  'currentAssetsVnd',
  'currentLiabilitiesVnd',
  'longTermLiabilitiesVnd',
  'equityVnd',
  'minorityEquityVnd',
  'operatingCashFlowVnd',
  'capexVnd',
  'freeCashFlowVnd',
  'dividendsPaidVnd',
  'sharesOutstanding',
] as const;
export function isFinancialData(value: unknown): value is FinancialData {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as FinancialData;
  if (
    typeof d.symbol !== 'string' ||
    !/^[A-Z0-9]{3,12}$/.test(d.symbol) ||
    d.source !== 'KBS_VIETCAP' ||
    d.verification !== 'provider_reported' ||
    typeof d.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(d.fetchedAt)) ||
    !Number.isInteger(d.businessType) ||
    typeof d.supported !== 'boolean' ||
    d.supported !== (d.businessType === 1) ||
    !Array.isArray(d.annual) ||
    d.annual.length > 8 ||
    !Array.isArray(d.notices) ||
    !d.notices.every((n) => typeof n === 'string') ||
    (d.currentShares !== null &&
      (!Number.isSafeInteger(d.currentShares) || d.currentShares <= 0))
  )
    return false;
  let previous = 0;
  for (const a of d.annual) {
    if (
      !a ||
      !Number.isInteger(a.year) ||
      a.year < 1990 ||
      a.year <= previous ||
      a.periodEnd !== `${a.year}-12-31` ||
      typeof a.publishedAt !== 'string' ||
      !Number.isFinite(Date.parse(a.publishedAt)) ||
      Date.parse(a.publishedAt) > Date.parse(d.fetchedAt) ||
      typeof a.audited !== 'boolean' ||
      typeof a.consolidated !== 'boolean' ||
      !numericFields.every(
        (k) =>
          a[k] === null ||
          (typeof a[k] === 'number' &&
            Number.isFinite(a[k]) &&
            Math.abs(a[k]) <= 1e18),
      )
    )
      return false;
    if (
      a.sharesOutstanding !== null &&
      (!Number.isSafeInteger(a.sharesOutstanding) || a.sharesOutstanding <= 0)
    )
      return false;
    previous = a.year;
  }
  return true;
}
