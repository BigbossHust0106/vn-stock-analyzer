import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  FireantProvider,
  fireantFinancialData,
  parseFireantReport,
  type FireantReportType,
} from '../../modules/providers/fireant-provider';
import { parseBackupStatement } from '../../modules/providers/financial-backup';
import {
  financialData,
  parseKbsReport,
  type ReportType,
} from '../../modules/providers/financial-schema';
import {
  financialRegression,
  isFinancialData,
  type FinancialData,
} from '../../modules/providers/financial-types';
import {
  FallbackFundamentals,
  providers,
} from '../../modules/providers/registry';
// Fixture thật tải 16/10/2026 (FireAnt + Vietcap), không chứa token, không chỉnh tay.
const now = '2026-10-16T10:00:00Z';
const load = (name: string): unknown =>
  JSON.parse(readFileSync(`fixtures/fireant-2026-10-16/${name}.json`, 'utf8'));
function build(
  symbol: string,
  mutate?: (raw: Record<string, unknown>) => void,
) {
  const raw: Record<string, unknown> = {
    1: load(`${symbol}-1`),
    2: load(`${symbol}-2`),
    4: load(`${symbol}-4`),
    income: load(`${symbol}-vci-income`),
    ratios: load(`${symbol}-vci-ratios`),
  };
  mutate?.(raw);
  const reports = Object.fromEntries(
    ([1, 2, 4] as const).map((t) => [t, parseFireantReport(raw[t], t)]),
  ) as Record<FireantReportType, ReturnType<typeof parseFireantReport>>;
  return fireantFinancialData(
    symbol,
    reports,
    parseBackupStatement(raw.income, symbol),
    raw.ratios,
    now,
  );
}
it('FireAnt VNM 2025: đơn vị đồng, EPS năm Vietcap 4.028, tỷ suất khớp KBS', () => {
  const d = build('VNM');
  expect(isFinancialData(d)).toBe(true);
  expect(d.source).toBe('FIREANT_VIETCAP');
  expect(d.annual.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025]);
  const a = d.annual.at(-1)!;
  // FireAnt đã là VND: 63.645.886.756.227 đ, KHÔNG nhân 1000.
  expect(a.revenueVnd).toBe(63645886756227);
  // EPS cơ bản đã công bố (Vietcap isa23), không phải LNST/số CP = 4.502,58.
  expect(a.epsAnnualVnd).toBe(4028);
  expect(a.publishedAt).toBe('2026-03-02T23:59:59+07:00');
  // ROEA tay: 9.410.201.646.692 / ((30.685.382.906.886 + 32.278.819.541.005)/2)
  // = 9.410.201.646.692 / 31.482.101.223.945,5 = 0,298906 (KBS ROEA 29,89%).
  expect(a.roe).toBeCloseTo(0.298906, 6);
  // ROAA tay: 9.413.589.732.469 / ((53.312.370.717.301 + 55.049.061.537.061)/2)
  // = 0,173744 (KBS ROAA 17,37%).
  expect(a.roa).toBeCloseTo(0.173744, 6);
  // Biên gộp tay: 26.209.474.194.531 / 63.645.886.756.227 = 0,411802 (KBS 41,18%).
  expect(a.grossMargin).toBeCloseTo(0.411802, 6);
  // Biên ròng tay: 9.413.589.732.469 / 63.645.886.756.227 = 0,147906 (KBS 14,79%).
  expect(a.netMargin).toBeCloseTo(0.147906, 6);
  // BVPS tay: (34.483.015.286.107 − 3.797.632.379.221) / 2.089.955.445 = 14.682,31.
  expect(a.bvpsVnd).toBeCloseTo(14682.31, 1);
  // Capex/cổ tức nguồn ghi âm (chi tiền) => lưu dương; FCF = CFO + capex âm.
  expect(a.capexVnd).toBe(1762010725342);
  expect(a.freeCashFlowVnd).toBe(8668137048520 - 1762010725342);
  expect(a.dividendsPaidVnd).toBe(11264484596250);
  expect(a.debtToEquity).toBeNull();
  // Năm đầu chưa có số dư đầu kỳ => ROE/ROA không đủ dữ liệu, không NaN.
  expect(d.annual[0]!.roe).toBeNull();
  expect(d.annual[0]!.roa).toBeNull();
  expect(d.notices.some((n) => n.includes('Giả định'))).toBe(true);
});
it('FireAnt và KBS cùng kỳ VNM 2025 lệch < 1.000 đ do KBS làm tròn nghìn đồng', () => {
  const kbs = (t: ReportType) =>
    parseKbsReport(
      JSON.parse(readFileSync(`fixtures/phase3/VNM-${t}-1.json`, 'utf8')),
      t,
      now,
    );
  const k = financialData(
    'VNM',
    {
      KQKD: kbs('KQKD'),
      CDKT: kbs('CDKT'),
      LCTT: kbs('LCTT'),
      CSTC: kbs('CSTC'),
    },
    JSON.parse(readFileSync('fixtures/phase3/VNM-vci-ratios.json', 'utf8')),
    now,
  ).annual.find((r) => r.year === 2025)!;
  const f = build('VNM').annual.at(-1)!;
  expect(f.epsAnnualVnd).toBe(k.epsAnnualVnd);
  for (const key of [
    'revenueVnd',
    'netProfitVnd',
    'parentProfitVnd',
    'currentAssetsVnd',
    'currentLiabilitiesVnd',
    'longTermLiabilitiesVnd',
    'equityVnd',
    'minorityEquityVnd',
    'operatingCashFlowVnd',
    'capexVnd',
    'dividendsPaidVnd',
  ] as const)
    expect(Math.abs(f[key]! - k[key]!)).toBeLessThan(1000);
});
it('DHG không có lợi ích CĐ không kiểm soát: không coi là hợp nhất, không lưu năm nào', () => {
  const d = build('DHG');
  expect(d.annual).toEqual([]);
  expect(
    d.notices.some((n) => n.includes('không cho thấy BCTC hợp nhất')),
  ).toBe(true);
});
it('LNST công ty mẹ hai nguồn lệch hoặc thiếu ngày công bố thì bỏ năm đó', () => {
  const d = build('VNM', (raw) => {
    const income = raw.income as {
      data: {
        years: {
          yearReport: number;
          isa22: number;
          publicDate: string | null;
        }[];
      };
    };
    const y2025 = income.data.years.find((y) => y.yearReport === 2025)!;
    // 9.410.201.646.692 × 1,001 => lệch 0,1% > 0,01% => không cùng bộ BCTC.
    y2025.isa22 *= 1.001;
    income.data.years.find((y) => y.yearReport === 2024)!.publicDate = null;
  });
  expect(d.annual.map((r) => r.year)).toEqual([2022, 2023]);
});
it('Nhãn chỉ tiêu đổi, kỳ quý, giá trị chuỗi hoặc capex dương đều bị từ chối', () => {
  expect(() =>
    build('VNM', (raw) => {
      (raw[2] as { id: number; name: string }[]).find((r) => r.id === 3)!.name =
        'EPS quý';
    }),
  ).toThrow('thay đổi nhãn');
  const quarter = structuredClone(load('VNM-2')) as {
    values: { quarter: number }[];
  }[];
  quarter[0]!.values[0]!.quarter = 3;
  expect(() => parseFireantReport(quarter, 2)).toThrow('không phải năm');
  const text = structuredClone(load('VNM-2')) as {
    values: { value: unknown }[];
  }[];
  text[0]!.values[0]!.value = '1';
  expect(() => parseFireantReport(text, 2)).toThrow();
  expect(() => parseFireantReport(null, 2)).toThrow('rỗng');
  expect(() =>
    build('VNM', (raw) => {
      const cf = raw[4] as { id: number; values: { value: number }[] }[];
      cf.find((r) => r.id === 201)!.values.at(-1)!.value = 5;
    }),
  ).toThrow('Capex');
});
it('Snapshot FireAnt thiếu Nợ vay/VCSH nên không ghi đè snapshot KBS đầy đủ', () => {
  const kbs = (t: ReportType) =>
    parseKbsReport(
      JSON.parse(readFileSync(`fixtures/phase3/VNM-${t}-1.json`, 'utf8')),
      t,
      now,
    );
  const good = financialData(
    'VNM',
    {
      KQKD: kbs('KQKD'),
      CDKT: kbs('CDKT'),
      LCTT: kbs('LCTT'),
      CSTC: kbs('CSTC'),
    },
    JSON.parse(readFileSync('fixtures/phase3/VNM-vci-ratios.json', 'utf8')),
    now,
  );
  expect(financialRegression(good, build('VNM'))).toBe(true);
});
const sample = (annual: number, supported = true) =>
  ({
    symbol: 'VNM',
    supported,
    annual: Array.from({ length: annual }, () => ({})),
  }) as unknown as FinancialData;
function fallbackWith(
  primary: () => Promise<FinancialData>,
  backup: () => Promise<FinancialData>,
) {
  const p = { fetchFinancials: vi.fn(primary) };
  const b = { fetchFinancials: vi.fn(backup) };
  return {
    p,
    b,
    f: new FallbackFundamentals(
      p as unknown as ConstructorParameters<typeof FallbackFundamentals>[0],
      b,
    ),
  };
}
it('Dự phòng: KBS tốt thì không gọi FireAnt; KBS lỗi/rỗng mới dùng FireAnt', async () => {
  const ok = fallbackWith(
    async () => sample(4),
    async () => sample(4),
  );
  expect((await ok.f.fetchFinancials('VNM')).annual).toHaveLength(4);
  expect(ok.b.fetchFinancials).not.toHaveBeenCalled();
  const bank = fallbackWith(
    async () => sample(0, false),
    async () => sample(4),
  );
  expect((await bank.f.fetchFinancials('VCB')).supported).toBe(false);
  expect(bank.b.fetchFinancials).not.toHaveBeenCalled();
  const down = fallbackWith(
    async () => {
      throw Error('KBS HTTP 503');
    },
    async () => sample(3),
  );
  expect((await down.f.fetchFinancials('VNM')).annual).toHaveLength(3);
  const empty = fallbackWith(
    async () => sample(0),
    async () => sample(0),
  );
  expect((await empty.f.fetchFinancials('NT2')).annual).toHaveLength(0);
  const both = fallbackWith(
    async () => {
      throw Error('KBS lỗi');
    },
    async () => {
      throw Error('FireAnt 401');
    },
  );
  await expect(both.f.fetchFinancials('VNM')).rejects.toThrow(
    'KBS và FireAnt đều chưa trả BCTC hợp lệ',
  );
});
it('Token: gửi Bearer chỉ tới FireAnt, lỗi không lộ token; token sai định dạng chỉ tắt dự phòng', async () => {
  const token = 'aaa.bbb.ccc';
  const calls: { url: string; auth: string | null }[] = [];
  const transport = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get('Authorization'),
      });
      return new Response('unauthorized', { status: 401 });
    },
  ) as unknown as typeof fetch;
  const p = new FireantProvider(token, transport, {
    ttlMs: 0,
    minIntervalMs: 0,
    retries: 0,
    retryDelayMs: 0,
    timeoutMs: 1000,
  });
  const error = await p
    .fetchFinancials('VNM', new Date(now))
    .catch((e: Error) => e);
  expect(String(error)).not.toContain(token);
  expect(calls[0]).toEqual({
    url: 'https://restv2.fireant.vn/symbols/VNM/full-financial-reports?type=1&year=2026&quarter=0&limit=4',
    auth: 'Bearer ' + token,
  });
  expect(() => new FireantProvider('not a jwt')).toThrow('không hợp lệ');
  expect(
    providers({ FIREANT_API_TOKEN: 'not a jwt' }).fundamentals,
  ).not.toBeInstanceOf(FallbackFundamentals);
  expect(providers({ FIREANT_API_TOKEN: token }).fundamentals).toBeInstanceOf(
    FallbackFundamentals,
  );
  expect(providers({}).fundamentals).not.toBeInstanceOf(FallbackFundamentals);
});
