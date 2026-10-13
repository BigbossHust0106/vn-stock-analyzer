import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { KbsProvider } from '../../modules/providers/kbs-provider';
import { VpsProvider } from '../../modules/providers/vps-provider';
import {
  financialData,
  parseKbsReport,
  parseVciFinancialRatios,
  type ReportType,
} from '../../modules/providers/financial-schema';
import { isFinancialData } from '../../modules/providers/financial-types';
import { defaultHttpOptions } from '../../modules/providers/http';
const now = '2026-10-13T10:00:00Z';
const raw = (symbol: string, type: string, page = 1): unknown =>
  JSON.parse(
    readFileSync(`fixtures/phase3/${symbol}-${type}-${page}.json`, 'utf8'),
  );
const ratios = (symbol: string): unknown =>
  JSON.parse(readFileSync(`fixtures/phase3/${symbol}-vci-ratios.json`, 'utf8'));
function reports(symbol: string) {
  return Object.fromEntries(
    (['KQKD', 'CDKT', 'LCTT', 'CSTC'] as const).map((t) => [
      t,
      parseKbsReport(raw(symbol, t), t, now),
    ]),
  ) as Record<ReportType, ReturnType<typeof parseKbsReport>>;
}
it.each(['VNM', 'FPT', 'HPG'])(
  'Parse fixture thật %s: annual hợp nhất kiểm toán, đơn vị VND/ratio',
  (symbol) => {
    const d = financialData(symbol, reports(symbol), ratios(symbol), now);
    expect(isFinancialData(d)).toBe(true);
    expect(d.annual.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025]);
    expect(d.annual.at(-1)?.roe).toBeGreaterThan(0);
    expect(d.annual.at(-1)?.roe).toBeLessThan(1);
  },
);
it('VNM 2025 giữ EPS4028 VND; doanh thu raw63645886756 nghìn =>63645886756000 VND; không dùng EPS TTM4502.58', () => {
  const a = financialData('VNM', reports('VNM'), ratios('VNM'), now).annual.at(
    -1,
  )!;
  expect(a.epsAnnualVnd).toBe(4028);
  expect(a.revenueVnd).toBe(63645886756000);
  // FCF = 8668137049000 − 1762010725000 = 6906126324000 VND.
  expect(a.freeCashFlowVnd).toBe(6906126324000);
  // BVPS parent = (34483015286000 − 3797632379000) / 2089955445 =14682.314391... VND.
  expect(a.bvpsVnd).toBeCloseTo(14682.314391156793, 6);
  expect(a.roic).toBeCloseTo(0.2426899808, 10);
  expect(a.publishedAt).toBe('2026-03-02T23:59:59+07:00');
});
it('Provider gọi đúng URL đã quan sát, cache bản sao và không bịa trang2 rỗng', async () => {
  const transport = vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    return Response.json(
      u.hostname === 'iq.vietcap.com.vn'
        ? ratios('VNM')
        : raw(
            'VNM',
            u.searchParams.get('type')!,
            Number(u.searchParams.get('page')),
          ),
    );
  });
  const p = new KbsProvider(transport, {
    ...defaultHttpOptions,
    minIntervalMs: 0,
    retries: 0,
  });
  const d = await p.fetchFinancials('VNM');
  d.annual[0]!.epsAnnualVnd = 999;
  const again = await p.fetchFinancials('VNM');
  expect(again.annual[0]!.epsAnnualVnd).not.toBe(999);
  expect(transport).toHaveBeenCalledTimes(9);
  expect(
    transport.mock.calls.filter(([u]) => String(u).includes('termtype=1')),
  ).toHaveLength(8);
  await expect(new VpsProvider().fetchFinancials('VNM')).rejects.toThrow(
    'không có endpoint BCTC',
  );
  await expect(p.fetchFinancials("VNM'")).rejects.toThrow();
});
it('Thiếu/sai kiểu, EPS chuỗi, quý, duplicate, nhãn/đơn vị thay đổi phải báo lỗi', () => {
  for (const p of [null, {}, { Head: [], Content: [] }])
    expect(() => parseKbsReport(p, 'KQKD', now)).toThrow('Head/Content');
  const original = raw('VNM', 'KQKD') as {
    Head: Record<string, unknown>[];
    Content: Record<string, Record<string, unknown>[]>;
  };
  for (const mutate of [
    (p: typeof original) => {
      p.Head[0]!.TermCode = 'Q1';
    },
    (p: typeof original) => {
      p.Head[0]!.DatePubDepartment = null;
    },
    (p: typeof original) => {
      p.Head.push(p.Head[0]!);
    },
    (p: typeof original) => {
      Object.values(p.Content)[0]![0]!.Value1 = '123';
    },
    (p: typeof original) => {
      delete Object.values(p.Content)[0]![0]!.Value1;
    },
    (p: typeof original) => {
      Object.values(p.Content)[0]![0]!.Value1 = Infinity;
    },
  ]) {
    const p = structuredClone(original);
    mutate(p);
    expect(() => parseKbsReport(p, 'KQKD', now)).toThrow();
  }
  const r = reports('VNM');
  r.KQKD[0]!.rows.get(2215)!.name = 'EPS quý';
  expect(() => financialData('VNM', r, ratios('VNM'), now)).toThrow(
    'thay đổi nhãn/đơn vị',
  );
  const rk = reports('VNM');
  rk.CSTC[0]!.rows.get(45)!.unit = 'Lần';
  expect(() => financialData('VNM', rk, ratios('VNM'), now)).toThrow(
    'thay đổi nhãn/đơn vị',
  );
  const wrong = ratios('VNM') as { data: Record<string, unknown>[] };
  wrong.data[0]!.organCode = 'FPT';
  expect(() => parseVciFinancialRatios(wrong, 'VNM', now)).toThrow('sai mã');
  expect(() =>
    parseVciFinancialRatios(
      { successful: false, status: 200, data: [] },
      'VNM',
      now,
    ),
  ).toThrow('không thành công');
});
it('Chặn publication tương lai, không làm tròn missing thành0; mất Vietcap không đoán số cổ phiếu', () => {
  expect(
    parseKbsReport(raw('VNM', 'KQKD'), 'KQKD', '2024-01-01T00:00:00Z'),
  ).toHaveLength(1);
  const d = financialData('VNM', reports('VNM'), null, now);
  expect(d.currentShares).toBeNull();
  expect(d.annual.every((a) => a.bvpsVnd === null && a.roic === null)).toBe(
    true,
  );
  const invalid = structuredClone(d);
  invalid.annual[0]!.epsAnnualVnd = NaN;
  expect(isFinancialData(invalid)).toBe(false);
  expect(isFinancialData(null)).toBe(false);
});

it('VNM báo cáo 2025 KBS và Vietcap: EPS khớp; tiền chênh <1000 VND do raw nghìn', () => {
  const a = financialData('VNM', reports('VNM'), ratios('VNM'), now).annual.at(
    -1,
  )!;
  const report = (section: string) => {
    const p = JSON.parse(
      readFileSync(`fixtures/phase3/VNM-vci-${section}.json`, 'utf8'),
    );
    return p.data.years.find(
      (r: { yearReport: number; lengthReport: number }) =>
        r.yearReport === 2025 && r.lengthReport === 5,
    ) as Record<string, number>;
  };
  expect(a.epsAnnualVnd).toBe(report('income').isa23);
  for (const [v, expected] of [
    [a.revenueVnd, report('income').isa3],
    [a.equityVnd, report('balance').bsa78],
    [a.minorityEquityVnd, report('balance').bsa210],
    [a.operatingCashFlowVnd, report('cash').cfa18],
    [a.capexVnd, -report('cash').cfa19!],
    [a.dividendsPaidVnd, -report('cash').cfa32!],
  ])
    expect(Math.abs(v! - expected!)).toBeLessThan(1000);
});
it('Không sử dụng ratio quý chưa kết thúc cho số cổ phiếu mới nhất', () => {
  const d = ratios('VNM') as { data: Record<string, unknown>[] };
  d.data.push({
    ...d.data.at(-1),
    yearReport: 2026,
    quarter: 4,
    ratioType: 'RATIO_TTM',
    numberOfSharesMktCap: 999,
  });
  expect(parseVciFinancialRatios(d, 'VNM', now).at(-1)?.shares).toBe(
    2089955445,
  );
});
