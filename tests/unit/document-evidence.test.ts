import { expect, it } from 'vitest';
import {
  documentEvidenceFor,
  validDocumentEvidence,
  parentEvidence,
} from '../../modules/providers/document-evidence';
import { financialData } from '../../modules/providers/financial-schema';
import {
  financialRegression,
  isFinancialData,
} from '../../modules/providers/financial-types';
import { graham } from '../../modules/strategies/graham';
import { seriesEvidence } from '../../modules/strategies/strategy';
const asOf = '2026-10-14T10:00:00Z';
it('DPR: số tiền VND đối chiếu mã36 BCTC riêng PDF, không lấy cổ tức tập đoàn', () => {
  const rows = documentEvidenceFor('DPR', asOf);
  // Primary statements, PDF p139/p11: 130,823,850,850; 129,878,461,200; 173,304,337,550 VND.
  expect(rows.map((r) => r.dividendsPaidVnd)).toEqual([
    130823850850, 129878461200, 173304337550,
  ]);
  expect(rows.at(-1)!.operatingCashFlowVnd).toBe(185871276131);
  expect(rows.at(-1)!.capexVnd).toBe(47675850674);
  expect(rows.at(-1)!.dividendsPaidVnd).not.toBe(173553738000); // Consolidated provider amount differs.
  expect(documentEvidenceFor('VNM', asOf)).toEqual([]);
  expect(documentEvidenceFor('DPR', 'bad')).toEqual([]);
  expect(documentEvidenceFor('DPR', '2026-10-14T09:00:00Z')).toEqual([]);
  expect(parentEvidence(rows, 2025, '2026-10-14T09:00:00Z')).toBeUndefined();
  expect(parentEvidence(rows, 2025, asOf)?.pdfPage).toBe(11);
});
it('Bằng chứng không chấp nhận thiếu trang/hash, sai đơn vị, số NaN, năm trùng hoặc dòng tiền cổ tức âm', () => {
  const rows = documentEvidenceFor('DPR', asOf);
  expect(validDocumentEvidence(null)).toBe(false);
  expect(validDocumentEvidence([null])).toBe(false);
  expect(validDocumentEvidence([rows[0], rows[0]])).toBe(false);
  for (const patch of [
    { unit: '1000' },
    { scope: 'group' },
    { pdfPage: 0 },
    { documentSha256: 'x' },
    { sourceUrl: 'javascript:alert(1)' },
    { verifiedAt: 'bad' },
    { capexVnd: NaN },
    { dividendsPaidVnd: -1 },
  ])
    expect(validDocumentEvidence([{ ...rows[0], ...patch }])).toBe(false);
});
it('Cổ tức có bằng chứng riêng mới tháo unknown khi tồn tại NCI; không đổi dữ liệu tài chính gốc', () => {
  // Use a minimal normalized financial object; only the three-year dividend criterion is inspected.
  const f = financialData(
    'DPR',
    { KQKD: [], CDKT: [], LCTT: [], CSTC: [] },
    null,
    asOf,
  );
  f.supported = true;
  f.businessType = 1;
  f.currentShares = 100;
  f.annual = [2023, 2024, 2025].map((year) => ({
    year,
    periodEnd: year + '-12-31',
    publishedAt: year + 1 + '-04-01T00:00:00Z',
    audited: true,
    consolidated: true,
    revenueVnd: null,
    netProfitVnd: null,
    parentProfitVnd: null,
    epsAnnualVnd: null,
    bvpsVnd: null,
    roe: null,
    roa: null,
    roic: null,
    grossMargin: null,
    netMargin: null,
    debtToEquity: null,
    currentAssetsVnd: null,
    currentLiabilitiesVnd: null,
    longTermLiabilitiesVnd: null,
    equityVnd: null,
    minorityEquityVnd: 1,
    operatingCashFlowVnd: null,
    capexVnd: null,
    freeCashFlowVnd: null,
    dividendsPaidVnd: 1,
    sharesOutstanding: 100,
  }));
  expect(
    graham(f, null, asOf).criteria.find((c) => c.id === 'dividends')?.status,
  ).toBe('unknown');
  f.documentEvidence = documentEvidenceFor('DPR', asOf);
  expect(isFinancialData(f)).toBe(true);
  expect(financialRegression(f, { ...f, documentEvidence: [] })).toBe(true);
  expect(
    graham(f, null, asOf).criteria.find((c) => c.id === 'dividends')?.status,
  ).toBe('pass');
  f.fetchedAt = '2026-10-14T09:00:00Z';
  expect(isFinancialData(f)).toBe(false);
  expect(seriesEvidence(f.annual, 'roe', 0.01, '%')).toContain('thiếu dữ liệu');
});
