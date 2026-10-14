import { expect, it } from 'vitest';
import {
  rankStock,
  technicalScores,
  priceChange,
  type RankingInput,
  type RankingBar,
} from '../../modules/scoring/rankings';
import type {
  FinancialData,
  AnnualFinancials,
} from '../../modules/providers/financial-types';
import { inTradingHours } from '../../modules/market/trading-hours';
import { safeNext } from '../../web/lib/auth';
const stamp = '2026-10-14T09:00:00Z';
function input(): RankingInput {
  const annual: AnnualFinancials[] = [2023, 2024, 2025].map((year) => ({
    year,
    periodEnd: year + '-12-31',
    publishedAt: year + 1 + '-03-01T00:00:00Z',
    audited: true,
    consolidated: true,
    revenueVnd: 200e9,
    netProfitVnd: 20e9,
    parentProfitVnd: 20e9,
    epsAnnualVnd: 4000,
    bvpsVnd: 25000,
    roe: 0.2,
    roa: 0.1,
    roic: 0.2,
    grossMargin: 0.3,
    netMargin: 0.15,
    debtToEquity: 0.1,
    currentAssetsVnd: 300e9,
    currentLiabilitiesVnd: 100e9,
    longTermLiabilitiesVnd: 20e9,
    equityVnd: 250e9,
    minorityEquityVnd: 0,
    operatingCashFlowVnd: 100e9,
    capexVnd: 20e9,
    freeCashFlowVnd: 80e9,
    dividendsPaidVnd: 2e9,
    sharesOutstanding: 10e6,
  }));
  const financials: FinancialData = {
    symbol: 'TST',
    source: 'KBS_VIETCAP',
    verification: 'provider_reported',
    fetchedAt: stamp,
    businessType: 1,
    supported: true,
    currentShares: 10e6,
    annual,
    notices: [],
  };
  return {
    stockId: 'test',
    financials,
    priceVnd: 20000,
    referenceVnd: 20000,
    quoteFetchedAt: stamp,
    bars: [],
    events: [],
    asOf: stamp,
  };
}
function bars(): RankingBar[] {
  return Array.from({ length: 51 }, (_, i) => ({
    session_date: new Date(Date.parse('2026-08-25T00:00:00Z') + i * 86400000)
      .toISOString()
      .slice(0, 10),
    close_vnd: 100,
    volume_shares: 1000,
    price_basis: 'adjusted',
    source: 'verified-test',
  }));
}
it('Đơn vị VND: 22000/20000−1=10%; 35%×100+15%×100=50, thiếu kỹ thuật không phân bổ lại', () => {
  const i = input();
  i.priceVnd = 22000;
  const [day] = rankStock(i);
  expect(priceChange(22000, 20000)).toBe(10);
  expect(day!.value).toBe(50);
  expect(day!.explanation.coverage).toBe(0.5);
  expect(day!.explanation.marketCapVnd).toBe(220e9);
  expect(day!.explanation.strategies.shortTechnical).toBeNull();
});
it('Graham sqrt(22.5×4000×25000)=47434.1649025; MOS57.8362978644%, trọng số40%=23.1345191458', () => {
  const [, month, quarter] = rankStock(input());
  expect(month!.value).toBe(23.134); // MOS điểm57.836 (3 chữ số), ×.4=23.1344; làm tròn =>23.134.
  expect(month!.explanation.grahamMargin).toBeCloseTo(
    Number('0.5783629786442161'),
    10,
  );
  expect(month!.explanation.coverage).toBe(0.4);
  expect(quarter!.value).not.toBeNull();
  expect(quarter!.explanation.strategies.graham).toBe(100);
});
it('Sự kiện 31 ngày có nguồn/known_at, không coi không có dữ liệu là không có sự kiện', () => {
  const i = input();
  i.events = [
    {
      event_date: '2026-10-20',
      kind: 'earnings',
      title: 'KQKD',
      source_url: 'https://issuer.example/event',
      known_at: stamp,
    },
    {
      event_date: '2026-12-20',
      kind: 'dividend',
      title: 'Xa',
      source_url: 'https://issuer.example/dividend',
      known_at: stamp,
    },
    {
      event_date: '2026-10-21',
      kind: 'agm',
      title: 'Tương lai',
      source_url: 'https://issuer.example/agm',
      known_at: '2026-10-15T00:00:00Z',
    },
  ];
  const [, month] = rankStock(i);
  expect(month!.explanation.events).toHaveLength(1);
  expect(month!.explanation.strategies.events).toBe(100);
  expect(month!.explanation.coverage).toBe(0.6);
  expect(month!.explanation.reasons).toHaveLength(3);
});
it('Lọc rác, EPS âm, giá nghìn đồng nhầm VND, thiếu BCTC/quote, tương lai hoặc cũ không có điểm', () => {
  const variants = [
    input(),
    input(),
    input(),
    input(),
    input(),
    input(),
    input(),
    input(),
  ];
  variants[0]!.financials = null;
  variants[1]!.financials!.annual.at(-1)!.epsAnnualVnd = -1;
  variants[2]!.priceVnd = 20;
  variants[3]!.quoteFetchedAt = null;
  variants[4]!.quoteFetchedAt = '2026-09-01T00:00:00Z';
  variants[5]!.quoteFetchedAt = '2026-10-15T00:00:00Z';
  variants[6]!.financials!.currentShares = 1;
  variants[7]!.financials!.supported = false;
  for (const i of variants) {
    const rows = rankStock(i);
    expect(
      rows.every(
        (r) => r.value === null && r.insufficient_reason === 'không đủ dữ liệu',
      ),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/NaN|Infinity/);
  }
  const i = input();
  i.financials!.annual = i.financials!.annual.slice(0, 1);
  expect(rankStock(i).every((r) => r.value === null)).toBe(true);
  for (const price of [null, NaN, 0, Infinity])
    expect(priceChange(price, 20000)).toBeNull();
  expect(priceChange(100, 0)).toBeNull();
  expect(priceChange(18000, 20000)).toBe(-10);
});
it('51 giá100: SMA20/50=100, RSI100, MACD0 => kỹ thuật0; volume2000/mean1000 =>50', () => {
  const b = bars();
  b.at(-1)!.volume_shares = 2000;
  expect(technicalScores(b, stamp)).toEqual({
    short: 0,
    medium: 0,
    volume: 50,
  });
  // 50 giá100 rồi120: EMA12=103.076923, EMA26=101.481481; histogram>0.
  // SMA20=101, SMA50=100.4: short40+0+30=70, medium40+30+30=100.
  b.at(-1)!.close_vnd = 120;
  expect(technicalScores(b, stamp)).toEqual({
    short: 70,
    medium: 100,
    volume: 50,
  });
  const i = input();
  i.bars = b;
  expect(rankStock(i)[0]!.explanation.coverage).toBe(1);
  b.forEach((row) => (row.volume_shares = 0));
  expect(technicalScores(b, stamp).volume).toBeNull();
});
it('Từ chối history thiếu/basis trộn/unverified/NaN/trùng phiên/nguồn trộn/future/stale', () => {
  expect(technicalScores([], stamp).short).toBeNull();
  for (const variant of [
    'basis',
    'close',
    'volume',
    'duplicate',
    'source',
    'future',
    'stale',
    'time',
  ]) {
    const b = bars();
    let t = stamp;
    if (variant === 'basis') b[0]!.price_basis = 'unadjusted';
    if (variant === 'close') b[0]!.close_vnd = NaN;
    if (variant === 'volume') b[0]!.volume_shares = -1;
    if (variant === 'duplicate') b[0]!.session_date = b[1]!.session_date;
    if (variant === 'source') b[0]!.source = 'other';
    if (variant === 'future') b.at(-1)!.session_date = '2026-11-01';
    if (variant === 'stale') t = '2026-11-01T00:00:00Z';
    if (variant === 'time') t = 'invalid';
    expect(technicalScores(b, t)).toEqual({
      short: null,
      medium: null,
      volume: null,
    });
  }
});
it('Giờ Việt Nam, cả ba sàn, nghỉ trưa, lịch thiếu/đóng; không suy ra ngày nghỉ từ weekday', () => {
  const session = {
    session_date: '2026-10-14',
    is_open: true,
    closes_at: '2026-10-14T08:00:00Z',
  };
  for (const exchange of ['HOSE', 'HNX', 'UPCOM'] as const) {
    for (const time of ['02:00', '04:30', '06:00', '08:00'])
      expect(
        inTradingHours(
          session,
          Date.parse('2026-10-14T' + time + ':00Z'),
          exchange,
        ),
      ).toBe(true);
    for (const time of ['01:59', '04:31', '05:59', '08:01'])
      expect(
        inTradingHours(
          session,
          Date.parse('2026-10-14T' + time + ':00Z'),
          exchange,
        ),
      ).toBe(false);
  }
  expect(inTradingHours(null, Date.parse(stamp), 'HOSE')).toBe(false);
  expect(
    inTradingHours({ ...session, is_open: false }, Date.parse(stamp), 'HNX'),
  ).toBe(false);
  expect(
    inTradingHours(session, Date.parse('2026-10-15T02:00:00Z'), 'UPCOM'),
  ).toBe(false);
});
it('OAuth next chỉ chấp nhận route nội bộ, chặn open redirect', () => {
  for (const next of [
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    null,
    '/auth/callback',
  ])
    expect(safeNext(next)).toBe('/watchlists');
  for (const next of ['/settings', '/top10', '/watchlists'])
    expect(safeNext(next)).toBe(next);
});

it('Bằng chứng lịch/sự kiện phải có URL nguồn, không đoán ngày nghỉ hoặc ngày KQKD', async () => {
  const { parseEvidence } = await import('../../modules/market/evidence');
  const data = {
    sessions: [
      {
        session_date: '2026-10-14',
        is_open: true,
        closes_at: '2026-10-14T15:00:00+07:00',
        source: 'https://exchange.example/calendar',
        verified_at: '2026-10-13T00:00:00Z',
      },
    ],
    events: [
      {
        symbol: 'VNM',
        kind: 'earnings',
        event_date: '2026-10-20',
        title: 'Lịch KQKD công bố',
        source_url: 'https://issuer.example/disclosure',
        known_at: '2026-10-13T00:00:00Z',
      },
    ],
  };
  expect(parseEvidence(data, Date.parse(stamp)).sessions).toHaveLength(1);
  expect(() =>
    parseEvidence(
      { ...data, sessions: [{ ...data.sessions[0], source: 'weekday guess' }] },
      Date.parse(stamp),
    ),
  ).toThrow();
  expect(() =>
    parseEvidence(
      { ...data, events: [{ ...data.events[0], known_at: '2027-01-01' }] },
      Date.parse(stamp),
    ),
  ).toThrow();
  expect(() =>
    parseEvidence(
      {
        ...data,
        sessions: [{ ...data.sessions[0], session_date: '2026-02-30' }],
      },
      Date.parse(stamp),
    ),
  ).toThrow();
});
