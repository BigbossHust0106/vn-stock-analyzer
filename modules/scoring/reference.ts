// Bảng tham khảo tách riêng khỏi Top 10 chuẩn `complete-v1`.
// Chỉ nhận mã đã qua bộ lọc BCTC/giá/vốn hóa (EPS năm, lợi nhuận, vốn chủ dương;
// giá ≥1.000đ; vốn hóa ≥100 tỷ; BCTC ≤550 ngày; giá nhận trong 7 ngày) và có
// điểm trên phần dữ liệu hiện có. Phần thiếu KHÔNG được phân bổ lại trọng số,
// nên điểm tối đa = độ bao phủ × 100; luôn hiển thị kèm độ bao phủ và lý do thiếu.
export const referencePolicy = 'reference-v1';
export const referenceMinCoverage = 0.3;
export interface ReferenceCandidate {
  stock_id: string;
  symbol: string;
  score: number | null;
  explanation: {
    coverage: number;
    eligible?: boolean;
  };
}
export function referenceRows<T extends ReferenceCandidate>(
  rows: readonly T[],
  officialIds: ReadonlySet<string>,
  limit = 10,
): (T & { position: number; tier: 'reference' })[] {
  const seen = new Set<string>(officialIds);
  return rows
    .filter(
      (row) =>
        row.score !== null &&
        Number.isFinite(row.score) &&
        row.explanation.eligible === true &&
        Number.isFinite(row.explanation.coverage) &&
        row.explanation.coverage >= referenceMinCoverage,
    )
    .sort(
      (a, b) =>
        b.score! - a.score! ||
        b.explanation.coverage - a.explanation.coverage ||
        a.symbol.localeCompare(b.symbol),
    )
    .filter((row) => {
      if (seen.has(row.stock_id) || seen.has(row.symbol)) return false;
      seen.add(row.stock_id);
      seen.add(row.symbol);
      return true;
    })
    .slice(0, Math.max(0, limit))
    .map((row, i) => ({ ...row, position: i + 1, tier: 'reference' as const }));
}
