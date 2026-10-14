import dpr from '../../data/financial-evidence/DPR.json';
export interface DocumentFinancialEvidence {
  year: number;
  scope: 'parent';
  unit: 'VND';
  operatingCashFlowVnd: number;
  capexVnd: number;
  dividendsPaidVnd: number;
  sourceUrl: string;
  documentSha256: string;
  pdfPage: number;
  verifiedAt: string;
}
export function validDocumentEvidence(
  value: unknown,
): value is DocumentFinancialEvidence[] {
  if (!Array.isArray(value) || value.length > 8) return false;
  const seen = new Set<number>();
  return value.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const e = row as DocumentFinancialEvidence;
    if (
      !Number.isInteger(e.year) ||
      e.year < 1990 ||
      seen.has(e.year) ||
      e.scope !== 'parent' ||
      e.unit !== 'VND' ||
      !Number.isSafeInteger(e.pdfPage) ||
      e.pdfPage < 1 ||
      !/^[a-f0-9]{64}$/.test(e.documentSha256) ||
      typeof e.sourceUrl !== 'string' ||
      !e.sourceUrl.startsWith('https://') ||
      typeof e.verifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(e.verifiedAt)) ||
      Date.parse(`${e.year}-12-31T23:59:59Z`) >= Date.parse(e.verifiedAt)
    )
      return false;
    if (
      ![e.operatingCashFlowVnd, e.capexVnd, e.dividendsPaidVnd].every(
        (v) => Number.isSafeInteger(v) && Math.abs(v) <= 1e18,
      ) ||
      e.capexVnd < 0 ||
      e.dividendsPaidVnd < 0
    )
      return false;
    seen.add(e.year);
    return true;
  });
}
/** Curated primary-document observations. Does not verify other provider fields or Owner Earnings. */
export function documentEvidenceFor(
  symbol: string,
  asOf: string,
): DocumentFinancialEvidence[] {
  if (
    symbol !== dpr.symbol ||
    !Number.isFinite(Date.parse(asOf)) ||
    Date.parse(asOf) < Date.parse(dpr.verifiedAt)
  )
    return [];
  const rows = dpr.documents.flatMap((doc) =>
    doc.observations.map((row) => ({
      ...row,
      scope: 'parent' as const,
      unit: 'VND' as const,
      sourceUrl: doc.url,
      documentSha256: doc.sha256,
      pdfPage: doc.pdfPage,
      verifiedAt: dpr.verifiedAt,
    })),
  );
  if (!validDocumentEvidence(rows))
    throw new Error('Bằng chứng BCTC gốc không hợp lệ');
  return rows;
}
export function parentEvidence(
  rows: DocumentFinancialEvidence[] | undefined,
  year: number,
  asOf: string,
) {
  return rows?.find(
    (e) => e.year === year && Date.parse(e.verifiedAt) <= Date.parse(asOf),
  );
}
