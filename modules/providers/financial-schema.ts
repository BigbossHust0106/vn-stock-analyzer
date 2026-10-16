import { record, symbolValue } from './market-schema';
import { validSourceDate } from './source-evidence';
import type { AnnualFinancials, FinancialData } from './financial-types';
export type ReportType = 'KQKD' | 'CDKT' | 'LCTT' | 'CSTC';
interface ReportPeriod {
  year: number;
  publishedAt: string;
  audited: boolean;
  consolidated: boolean;
  businessType: number;
  // KBS đôi khi ghi sai PeriodBegin/PeriodEnd của kỳ năm (vd 2025: 202501–202612).
  periodAnomaly: boolean;
  rows: Map<
    number,
    { value: number | null; name: string; unit: string | null }
  >;
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e18;
export function parseKbsReport(
  payload: unknown,
  type: ReportType,
  now: string,
): ReportPeriod[] {
  if (
    !record(payload) ||
    !Array.isArray(payload.Head) ||
    !record(payload.Content)
  )
    throw new Error(`KBS ${type}: thiếu Head/Content`);
  const groups = Object.values(payload.Content);
  if (
    payload.Head.length === 0 &&
    groups.every((v) => Array.isArray(v) && v.length === 0)
  )
    return [];
  if (!groups.length || !groups.every(Array.isArray))
    throw new Error(`KBS ${type}: Content không hợp lệ`);
  const seen = new Set<number>();
  return payload.Head.map((h: unknown) => {
    if (
      !record(h) ||
      !Number.isInteger(h.ID) ||
      Number(h.ID) < 1 ||
      Number(h.ID) > 4 ||
      !Number.isInteger(h.YearPeriod) ||
      Number(h.YearPeriod) < 1990 ||
      h.TermCode !== 'N' ||
      typeof h.PeriodBegin !== 'string' ||
      typeof h.PeriodEnd !== 'string' ||
      !Number.isInteger(h.BusinessType) ||
      typeof h.United !== 'string' ||
      typeof h.AuditedStatus !== 'string'
    )
      throw new Error(`KBS ${type}: sai kỳ năm/metadata`);
    const year = Number(h.YearPeriod);
    if (seen.has(year)) throw new Error(`KBS ${type}: trùng năm`);
    seen.add(year);
    // Nguồn không gửi timezone; chỉ công bố tại ngày, bảo thủ cuối ngày Việt Nam.
    const date =
      typeof h.DatePubDepartment === 'string'
        ? h.DatePubDepartment.slice(0, 10)
        : '';
    if (!validSourceDate(date) || date <= `${year}-12-31`)
      throw new Error(`KBS ${type}: thiếu ngày công bố hợp lệ`);
    const publishedAt = `${date}T23:59:59+07:00`;
    const rows = new Map<
      number,
      { value: number | null; name: string; unit: string | null }
    >();
    for (const row of groups.flat() as unknown[]) {
      if (
        !record(row) ||
        !Number.isInteger(row.ReportNormID) ||
        typeof row.Name !== 'string' ||
        (row.Unit !== null && typeof row.Unit !== 'string')
      )
        throw new Error(`KBS ${type}: chỉ tiêu sai kiểu`);
      const id = Number(row.ReportNormID),
        value = row[`Value${h.ID}`];
      if (rows.has(id) || (value !== null && !finite(value)))
        throw new Error(
          `KBS ${type}: Value${h.ID} thiếu/sai kiểu hoặc trùng chỉ tiêu ${id}`,
        );
      rows.set(id, {
        value: value as number | null,
        name: row.Name,
        unit: row.Unit as string | null,
      });
    }
    return {
      year,
      publishedAt,
      audited: h.AuditedStatus === 'KT',
      consolidated: h.United === 'HN',
      businessType: Number(h.BusinessType),
      periodAnomaly:
        h.PeriodBegin !== `${year}01` || h.PeriodEnd !== `${year}12`,
      rows,
    };
  }).filter((r) => Date.parse(r.publishedAt) <= Date.parse(now));
}
interface VciRatio {
  year: number;
  quarter: number;
  shares: number | null;
  roic: number | null;
  netMargin: number | null;
}
// Vietcap trả organCode nội bộ (QNS => QNSC, SAB => SBCO); chỉ nhận ánh xạ khi
// chính endpoint công ty xác nhận ticker trùng mã được hỏi.
export function parseVciCompany(payload: unknown, symbol: string): string {
  if (
    !record(payload) ||
    payload.successful !== true ||
    payload.status !== 200 ||
    !record(payload.data) ||
    payload.data.ticker !== symbol ||
    typeof payload.data.organCode !== 'string' ||
    !/^[A-Z0-9]{3,12}$/.test(payload.data.organCode)
  )
    throw new Error('Vietcap: không xác nhận được organCode của mã');
  return payload.data.organCode;
}
export function vciOrganCodes(payload: unknown): string[] {
  return record(payload) && Array.isArray(payload.data)
    ? [
        ...new Set(
          payload.data
            .map((r: unknown) => (record(r) ? r.organCode : null))
            .filter((c): c is string => typeof c === 'string'),
        ),
      ]
    : [];
}
export function parseVciFinancialRatios(
  payload: unknown,
  symbol: string,
  now: string,
  organCode: string = symbol,
): VciRatio[] {
  if (
    !record(payload) ||
    payload.successful !== true ||
    payload.status !== 200 ||
    !Array.isArray(payload.data)
  )
    throw new Error('Vietcap: phản hồi ratios không thành công');
  const seen = new Set<string>();
  return payload.data
    .map((r: unknown) => {
      if (
        !record(r) ||
        (r.organCode !== symbol && r.organCode !== organCode) ||
        !['RATIO_TTM', 'RATIO_YEAR'].includes(String(r.ratioType)) ||
        !Number.isInteger(r.yearReport) ||
        !Number.isInteger(r.quarter) ||
        Number(r.quarter) < 1 ||
        Number(r.quarter) > 5
      )
        throw new Error('Vietcap: ratios sai mã/kỳ/kiểu');
      if ((r.ratioType === 'RATIO_YEAR') !== (r.quarter === 5))
        throw new Error('Vietcap: annual/TTM không khớp kỳ');
      const key = `${r.yearReport}-${r.quarter}`;
      if (seen.has(key)) throw new Error('Vietcap: ratios trùng kỳ');
      seen.add(key);
      if (
        r.numberOfSharesMktCap != null &&
        (!Number.isSafeInteger(r.numberOfSharesMktCap) ||
          Number(r.numberOfSharesMktCap) <= 0)
      )
        throw new Error('Vietcap: số cổ phiếu sai kiểu');
      if (r.roic != null && !finite(r.roic))
        throw new Error('Vietcap: ROIC sai kiểu');
      if (r.afterTaxProfitMargin != null && !finite(r.afterTaxProfitMargin))
        throw new Error('Vietcap: biên lợi nhuận sai kiểu');
      return {
        year: Number(r.yearReport),
        quarter: Number(r.quarter),
        shares: (r.numberOfSharesMktCap ?? null) as number | null,
        roic: (r.roic ?? null) as number | null,
        netMargin: (r.afterTaxProfitMargin ?? null) as number | null,
      };
    })
    .filter(
      (r) =>
        Date.UTC(r.year, r.quarter === 5 ? 12 : r.quarter * 3, 1) - 86400000 <=
        Date.parse(now),
    )
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}
// Chỉ chấp nhận kỳ năm KBS ghi sai PeriodBegin/PeriodEnd khi: các năm khác của
// cùng báo cáo đều là năm dương lịch chuẩn, và biên LNST/doanh thu thuần KBS khớp
// afterTaxProfitMargin năm đó của Vietcap (nguồn khác) trong 0,0001.
// Ví dụ tính tay: LNST 3.146,75 / DT 10.000 = 0,314675; Vietcap 0,3146751 => lệch
// 0,0000001 ≤ 0,0001 => khớp. Kỳ 24 tháng thật sẽ không khớp biên của năm.
export function periodAnomalyConfirmed(
  year: number,
  reports: Record<ReportType, ReportPeriod[]>,
  income: ReportPeriod | undefined,
  ratios: VciRatio[],
): boolean {
  const normalYears = new Set(
    reports.KQKD.filter((r) => !r.periodAnomaly && r.year !== year).map(
      (r) => r.year,
    ),
  );
  if (normalYears.size < 2) return false;
  const vietcap = ratios.find((r) => r.year === year && r.quarter === 5);
  const revenue = income?.rows.get(2216),
    profit = income?.rows.get(2212);
  if (
    !vietcap ||
    vietcap.netMargin === null ||
    !revenue ||
    !profit ||
    !/Doanh thu thuần/.test(revenue.name) ||
    !/Lợi nhuận sau thuế/.test(profit.name) ||
    revenue.unit !== null ||
    profit.unit !== null ||
    !finite(revenue.value) ||
    !finite(profit.value) ||
    revenue.value <= 0
  )
    return false;
  return Math.abs(profit.value / revenue.value - vietcap.netMargin) <= 0.0001;
}
export function financialData(
  symbol: string,
  reports: Record<ReportType, ReportPeriod[]>,
  ratioPayload: unknown,
  now: string,
  organCode: string = symbol,
): FinancialData {
  symbolValue(symbol);
  const ratios =
    ratioPayload === null
      ? []
      : parseVciFinancialRatios(ratioPayload, symbol, now, organCode);
  const periodNotices: string[] = [];
  const periodMap = (type: ReportType) =>
    new Map(reports[type].map((r) => [r.year, r]));
  for (const type of Object.keys(reports) as ReportType[])
    if (periodMap(type).size !== reports[type].length)
      throw new Error(`KBS ${type}: trùng năm giữa các trang`);
  const bs = periodMap('CDKT'),
    cf = periodMap('LCTT'),
    ratiosKbs = periodMap('CSTC');
  const annual: AnnualFinancials[] = [];
  const businessType =
    [...reports.KQKD, ...reports.CDKT, ...reports.LCTT].at(0)?.businessType ??
    -1;
  const incomes = periodMap('KQKD');
  const years = [
    ...new Set([...incomes.keys(), ...bs.keys(), ...cf.keys()]),
  ].sort((a, b) => a - b);
  for (const year of years) {
    const accepted = (r: ReportPeriod | undefined) =>
      r?.businessType === businessType && r.consolidated && r.audited
        ? r
        : undefined;
    const income = accepted(incomes.get(year)),
      b = accepted(bs.get(year)),
      cash = accepted(cf.get(year)),
      rk = ratiosKbs.get(year);
    const evidence = [income, b, cash].filter(
      (r): r is ReportPeriod => r !== undefined,
    );
    if (!evidence.length) continue;
    if ([...evidence, ...(rk ? [rk] : [])].some((r) => r.periodAnomaly)) {
      if (!periodAnomalyConfirmed(year, reports, income, ratios)) {
        periodNotices.push(
          `Năm ${year}: KBS ghi kỳ báo cáo sai định dạng và không đối chiếu được với Vietcap; bỏ năm này, không tự sửa kỳ.`,
        );
        continue;
      }
      periodNotices.push(
        `Năm ${year}: KBS ghi kỳ báo cáo sai định dạng; biên LNST/doanh thu khớp Vietcap năm ${year} (lệch ≤0,01 điểm %) nên coi là BCTC năm dương lịch — giả định, chưa đối chiếu PDF.`,
      );
    }
    const read = (
      r: ReportPeriod | undefined,
      id: number,
      expected: RegExp,
      unit: string | null,
      scale = 1000,
    ): number | null => {
      const row = r?.rows.get(id);
      if (!row) return null;
      if (!expected.test(row.name) || row.unit !== unit)
        throw new Error(`KBS: chỉ tiêu ${id} đã thay đổi nhãn/đơn vị`);
      if (row.value === null) return null;
      const value = row.value * scale;
      if (!finite(value))
        throw new Error(`KBS: chỉ tiêu ${id} vượt giới hạn sau đổi đơn vị`);
      return value;
    };
    const money = (r: ReportPeriod | undefined, id: number, label: RegExp) =>
      read(r, id, label, null);
    const percent = (id: number, label: RegExp) =>
      read(rk, id, label, '%', 0.01);
    const shares =
      ratios.find((r) => r.year === year && r.quarter === 5)?.shares ?? null;
    const equity = money(b, 2998, /VỐN CHỦ SỞ HỮU/),
      minority = money(b, 5320, /không kiểm soát/);
    const operating = money(cash, 2234, /thuần từ hoạt động kinh doanh/),
      rawCapex = money(cash, 2254, /mua sắm, xây dựng/);
    if (rawCapex !== null && rawCapex > 0)
      throw new Error('KBS: Capex đảo dấu so với contract chi tiền');
    const dividends = money(cash, 2266, /đã trả cho chủ sở hữu/);
    if (dividends !== null && dividends > 0)
      throw new Error('KBS: cổ tức đảo dấu');
    annual.push({
      year,
      periodEnd: `${year}-12-31`,
      publishedAt: [...evidence, ...(rk ? [rk] : [])]
        .map((r) => r.publishedAt)
        .sort()
        .at(-1)!,
      audited: true,
      consolidated: true,
      revenueVnd: money(income, 2216, /Doanh thu thuần/),
      netProfitVnd: money(income, 2212, /Lợi nhuận sau thuế/),
      parentProfitVnd: money(income, 2214, /Công ty mẹ/),
      epsAnnualVnd: read(income, 2215, /Lãi cơ bản trên cổ phiếu/, null, 1),
      bvpsVnd:
        equity !== null &&
        minority !== null &&
        shares !== null &&
        equity > minority
          ? (equity - minority) / shares
          : null,
      roe: percent(45, /ROEA/),
      roa: percent(47, /ROAA/),
      roic:
        ratios.find((r) => r.year === year && r.quarter === 5)?.roic ?? null,
      grossMargin: percent(41, /lợi nhuận gộp/),
      netMargin: percent(44, /doanh thu thuần/),
      debtToEquity: percent(11, /Nợ vay trên Vốn chủ sở hữu/),
      currentAssetsVnd: money(b, 3000, /TÀI SẢN NGẮN HẠN/),
      currentLiabilitiesVnd: money(b, 3014, /Nợ ngắn hạn/),
      longTermLiabilitiesVnd: money(b, 3017, /Nợ dài hạn/),
      equityVnd: equity,
      minorityEquityVnd: minority,
      operatingCashFlowVnd: operating,
      capexVnd: rawCapex === null ? null : -rawCapex,
      freeCashFlowVnd:
        operating !== null && rawCapex !== null ? operating + rawCapex : null,
      dividendsPaidVnd: dividends === null ? null : -dividends,
      sharesOutstanding: shares,
    });
  }
  return {
    symbol,
    source: 'KBS_VIETCAP',
    fetchedAt: now,
    verification: 'provider_reported',
    businessType,
    supported: businessType === 1,
    currentShares: ratios.at(-1)?.shares ?? null,
    annual: annual.sort((a, b) => a.year - b.year),
    notices: [
      'Chỉ dùng BCTC năm hợp nhất đã kiểm toán theo metadata nhà cung cấp; chưa đối chiếu đầy đủ PDF kiểm toán gốc.',
      'BVPS = (vốn chủ sở hữu − lợi ích CĐ không kiểm soát) / số cổ phiếu cuối năm Vietcap; khác BVPS tổng vốn của KBS.',
      'FCF = CFO − toàn bộ tiền đầu tư TSCĐ/tài sản dài hạn; không phải FCFE hoặc Owner Earnings đã xác minh.',
      ...(businessType !== 1
        ? ['Chưa hỗ trợ mô hình cho ngân hàng, chứng khoán và bảo hiểm.']
        : []),
      ...(ratios.length === 0 ? ['Chưa có ROIC/số cổ phiếu từ Vietcap.'] : []),
      ...periodNotices,
    ],
  };
}
