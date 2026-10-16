import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  financialData,
  parseKbsReport,
  parseVciCompany,
  parseVciFinancialRatios,
  vciOrganCodes,
  type ReportType,
} from '../../modules/providers/financial-schema';
import { isFinancialData } from '../../modules/providers/financial-types';
// Fixture thật tải 16/10/2026 từ KBS và Vietcap; không chỉnh tay giá trị.
const now = '2026-10-16T10:00:00Z';
const load = (name: string): unknown =>
  JSON.parse(readFileSync(`fixtures/sources-2026-10-16/${name}.json`, 'utf8'));
it('Vietcap QNS dùng organCode QNSC: chỉ nhận khi endpoint công ty xác nhận ticker', () => {
  const ratios = load('QNS-vci-ratios');
  expect(vciOrganCodes(ratios)).toEqual(['QNSC']);
  expect(() => parseVciFinancialRatios(ratios, 'QNS', now)).toThrow('sai mã');
  const organ = parseVciCompany(load('QNS-vci-company'), 'QNS');
  expect(organ).toBe('QNSC');
  const parsed = parseVciFinancialRatios(ratios, 'QNS', now, organ);
  // Số cổ phiếu năm 2025 trong fixture: 367.648.153 CP (không nhân/chia đơn vị).
  expect(parsed.find((r) => r.year === 2025 && r.quarter === 5)?.shares).toBe(
    367648153,
  );
  // Ánh xạ của mã khác không được dùng lại.
  expect(() => parseVciCompany(load('QNS-vci-company'), 'SAB')).toThrow(
    'organCode',
  );
  expect(() =>
    parseVciCompany({ successful: true, status: 200, data: {} }, 'QNS'),
  ).toThrow('organCode');
});
function reeReports(): Record<ReportType, ReturnType<typeof parseKbsReport>> {
  return {
    KQKD: parseKbsReport(load('REE-KQKD-1'), 'KQKD', now),
    CDKT: [],
    LCTT: [],
    CSTC: [],
  };
}
it('KBS REE 2025 ghi kỳ 202501–202612: nhận khi biên LNST khớp Vietcap, ghi rõ giả định', () => {
  const kqkd = reeReports().KQKD;
  expect(kqkd.map((r) => [r.year, r.periodAnomaly])).toEqual([
    [2025, true],
    [2024, false],
    [2023, false],
    [2022, false],
  ]);
  // Tính tay 2025: LNST 3.150.404.939 / DT thuần 10.011.611.125 (nghìn đồng)
  // = 0,3146751...; Vietcap afterTaxProfitMargin 0,3146751207 => lệch < 0,0001.
  const d = financialData('REE', reeReports(), load('REE-vci-ratios'), now);
  expect(isFinancialData(d)).toBe(true);
  expect(d.annual.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025]);
  const y2025 = d.annual.at(-1)!;
  // EPS năm (không phải quý/TTM) giữ nguyên 4.669 VND; doanh thu nghìn đồng ×1000.
  expect(y2025.epsAnnualVnd).toBe(4669);
  expect(y2025.revenueVnd).toBe(10011611125000);
  expect(
    d.notices.some((n) => n.includes('Năm 2025') && n.includes('giả định')),
  ).toBe(true);
});
it('Kỳ KBS sai định dạng mà không khớp nguồn khác thì bỏ riêng năm đó, không bịa kỳ', () => {
  const ratios = load('REE-vci-ratios') as {
    data: {
      yearReport: number;
      quarter: number;
      afterTaxProfitMargin: number;
    }[];
  };
  const shifted = structuredClone(ratios);
  // 0,3146751207 + 0,001 = 0,3156751207 => lệch 0,001 > 0,0001 => không khớp.
  shifted.data.find(
    (r) => r.yearReport === 2025 && r.quarter === 5,
  )!.afterTaxProfitMargin += 0.001;
  const d = financialData('REE', reeReports(), shifted, now);
  expect(d.annual.map((r) => r.year)).toEqual([2022, 2023, 2024]);
  expect(d.notices.some((n) => n.includes('bỏ năm này'))).toBe(true);
  // Không có Vietcap => không đối chiếu được => cũng bỏ năm 2025.
  expect(
    financialData('REE', reeReports(), null, now).annual.map((r) => r.year),
  ).toEqual([2022, 2023, 2024]);
  // Khi đa số năm đều lệch kỳ (có thể đổi niên độ thật) thì không chấp nhận.
  const allOdd = reeReports();
  for (const r of allOdd.KQKD.slice(0, 3)) r.periodAnomaly = true;
  expect(
    financialData('REE', allOdd, load('REE-vci-ratios'), now).annual.map(
      (r) => r.year,
    ),
  ).toEqual([2022]);
});
it('Kỳ không phải năm (TermCode quý) vẫn bị từ chối toàn bộ', () => {
  const p = structuredClone(load('REE-KQKD-1')) as {
    Head: Record<string, unknown>[];
  };
  p.Head[1]!.TermCode = 'Q1';
  expect(() => parseKbsReport(p, 'KQKD', now)).toThrow('sai kỳ năm');
});
