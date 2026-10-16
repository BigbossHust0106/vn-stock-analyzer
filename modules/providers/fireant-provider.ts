// Nguồn BCTC dự phòng: FireAnt (restv2) cho CĐKT/KQKD/LCTT năm + Vietcap cho EPS cơ
// bản đã công bố, ngày công bố, số cổ phiếu và ROIC. Khảo sát thật 16/10/2026:
// `symbols/{mã}/full-financial-reports?type=1|2|4&year=Y&quarter=0&limit=4` trả HTTP200,
// đơn vị **đồng** (KBS là nghìn đồng); VNM 2025 doanh thu thuần 63.645.886.756.227 đ
// khớp KBS 63.645.886.756 nghìn đồng. FireAnt KHÔNG có trạng thái kiểm toán, hợp nhất,
// ngày công bố, EPS cơ bản đã công bố; các phần đó lấy từ Vietcap hoặc ghi rõ giả định.
import { ProviderHttp, defaultHttpOptions, type HttpOptions } from './http';
import { record, symbolValue } from './market-schema';
import { parseBackupStatement, type BackupPeriod } from './financial-backup';
import {
  parseVciCompany,
  parseVciFinancialRatios,
  vciOrganCodes,
} from './financial-schema';
import type { AnnualFinancials, FinancialData } from './financial-types';
import { documentEvidenceFor } from './document-evidence';

export type FireantReportType = 1 | 2 | 4;
export interface FireantRow {
  name: string;
  values: Map<number, number | null>;
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e18;
export function parseFireantReport(
  payload: unknown,
  type: FireantReportType,
): Map<number, FireantRow> {
  if (!Array.isArray(payload) || payload.length === 0)
    throw new Error(`FireAnt ${type}: báo cáo rỗng hoặc sai cấu trúc`);
  const rows = new Map<number, FireantRow>();
  for (const row of payload as unknown[]) {
    if (
      !record(row) ||
      !Number.isSafeInteger(row.id) ||
      typeof row.name !== 'string' ||
      !Array.isArray(row.values) ||
      rows.has(Number(row.id))
    )
      throw new Error(`FireAnt ${type}: chỉ tiêu sai kiểu hoặc trùng`);
    const values = new Map<number, number | null>();
    for (const v of row.values as unknown[]) {
      if (
        !record(v) ||
        !Number.isInteger(v.year) ||
        Number(v.year) < 1990 ||
        Number(v.year) > 2100 ||
        v.quarter !== 0 ||
        (v.value !== null && !finite(v.value)) ||
        values.has(Number(v.year))
      )
        throw new Error(`FireAnt ${type}: kỳ không phải năm hoặc giá trị sai`);
      values.set(Number(v.year), v.value as number | null);
    }
    rows.set(Number(row.id), { name: row.name, values });
  }
  return rows;
}
// Mã chỉ tiêu FireAnt đã đối chiếu tên + giá trị với KBS (VNM, DHG 2025).
const fields = {
  totalAssets: [1, 2, /^TỔNG CỘNG TÀI SẢN/],
  currentAssets: [1, 101, /Tài sản lưu động và đầu tư ngắn hạn/],
  currentLiabilities: [1, 30101, /^I\. Nợ ngắn hạn/],
  longTermLiabilities: [1, 30102, /^II\. Nợ dài hạn/],
  equity: [1, 302, /Nguồn vốn chủ sở hữu/],
  minorityEquity: [1, 3020114, /Lợi ích của cổ đông không kiểm soát/],
  revenue: [2, 3, /^3\. Doanh thu thuần/],
  grossProfit: [2, 5, /^5\. Lợi nhuận gộp/],
  netProfit: [2, 19, /^19\. Lợi nhuận sau thuế thu nhập doanh nghiệp/],
  minorityProfit: [2, 20, /cổ đông không kiểm soát/],
  parentProfit: [2, 21, /cổ đông của công ty mẹ/],
  operatingCashFlow: [4, 104, /thuần từ hoạt động kinh doanh/],
  capex: [4, 201, /mua sắm, xây dựng TSCĐ/],
  dividendsPaid: [4, 308, /Cổ tức, lợi nhuận đã trả cho chủ sở hữu/],
} as const satisfies Record<string, [FireantReportType, number, RegExp]>;
type Field = keyof typeof fields;
export function fireantFinancialData(
  symbol: string,
  reports: Record<FireantReportType, Map<number, FireantRow>>,
  vciIncome: BackupPeriod[],
  ratioPayload: unknown,
  now: string,
  organCode: string = symbol,
): FinancialData {
  symbolValue(symbol);
  for (const [, [type, id, label]] of Object.entries(fields)) {
    const row = reports[type].get(id);
    if (row && !label.test(row.name))
      throw new Error(`FireAnt: chỉ tiêu ${id} đã thay đổi nhãn`);
  }
  if (!reports[2].get(3) || !reports[1].get(302))
    throw new Error('FireAnt: không phải mẫu BCTC doanh nghiệp được hỗ trợ');
  const value = (field: Field, year: number): number | null => {
    const [type, id] = fields[field];
    return reports[type].get(id)?.values.get(year) ?? null;
  };
  const ratios =
    ratioPayload === null
      ? []
      : parseVciFinancialRatios(ratioPayload, symbol, now, organCode);
  const notices: string[] = [];
  const annual: AnnualFinancials[] = [];
  const years = [...(reports[2].get(3)?.values.keys() ?? [])].sort(
    (a, b) => a - b,
  );
  const parentEquity = (year: number) => {
    const e = value('equity', year),
      m = value('minorityEquity', year);
    return e !== null && m !== null && e > m ? e - m : null;
  };
  for (const year of years) {
    const vci = vciIncome.find((r) => r.year === year);
    const revenue = value('revenue', year),
      net = value('netProfit', year),
      parent = value('parentProfit', year);
    const vciParent = vci?.fields.isa22 ?? null,
      eps = vci?.fields.isa23 ?? null;
    // Hai nguồn phải cùng một bộ BCTC: LNST công ty mẹ FireAnt ≈ Vietcap isa22.
    // Ví dụ VNM 2025: 9.410.201.646.692 = 9.410.201.646.692 => lệch 0 ≤ 0,01%.
    if (
      !vci?.publicDate ||
      parent === null ||
      vciParent === null ||
      Math.abs(parent - vciParent) > Math.max(1, Math.abs(vciParent) * 1e-4)
    ) {
      notices.push(
        `Năm ${year}: LNST công ty mẹ FireAnt không khớp/không có Vietcap kèm ngày công bố; bỏ năm này.`,
      );
      continue;
    }
    const publishedAt = `${vci.publicDate}T23:59:59+07:00`;
    if (Date.parse(publishedAt) > Date.parse(now)) continue;
    // Không có cờ hợp nhất: chỉ nhận khi có lợi ích CĐ không kiểm soát khác 0 (bằng
    // chứng có công ty con). Công ty chỉ có BCTC riêng lẻ bị loại, không đoán.
    const minorityProfit = value('minorityProfit', year),
      minorityEquity = value('minorityEquity', year);
    if (!minorityProfit && !minorityEquity) {
      notices.push(
        `Năm ${year}: FireAnt không cho thấy BCTC hợp nhất (lợi ích CĐ không kiểm soát = 0); bỏ năm này.`,
      );
      continue;
    }
    const shares =
      ratios.find((r) => r.year === year && r.quarter === 5)?.shares ?? null;
    const pe = parentEquity(year),
      peBefore = parentEquity(year - 1);
    const assets = value('totalAssets', year),
      assetsBefore = value('totalAssets', year - 1);
    const operating = value('operatingCashFlow', year),
      rawCapex = value('capex', year),
      dividends = value('dividendsPaid', year);
    if (rawCapex !== null && rawCapex > 0)
      throw new Error('FireAnt: Capex đảo dấu so với contract chi tiền');
    if (dividends !== null && dividends > 0)
      throw new Error('FireAnt: cổ tức đảo dấu');
    const ratio = (a: number | null, b: number | null) =>
      a !== null && b !== null && b > 0 ? a / b : null;
    const gross = value('grossProfit', year);
    annual.push({
      year,
      periodEnd: `${year}-12-31`,
      publishedAt,
      // Giả định: BCTC năm công bố sau kỳ là bản kiểm toán; FireAnt/Vietcap không ghi cờ.
      audited: true,
      consolidated: true,
      revenueVnd: revenue,
      netProfitVnd: net,
      parentProfitVnd: parent,
      epsAnnualVnd: finite(eps) ? eps : null,
      bvpsVnd: pe !== null && shares !== null ? pe / shares : null,
      // ROEA = LNST cty mẹ / bình quân VCSH cty mẹ đầu–cuối năm (khớp KBS VNM 2025
      // 29,89%); ROAA = LNST / bình quân tổng tài sản (khớp KBS 17,37%).
      roe:
        pe !== null && peBefore !== null
          ? ratio(parent, (pe + peBefore) / 2)
          : null,
      roa:
        assets !== null && assetsBefore !== null
          ? ratio(net, (assets + assetsBefore) / 2)
          : null,
      roic:
        ratios.find((r) => r.year === year && r.quarter === 5)?.roic ?? null,
      grossMargin: ratio(gross, revenue),
      netMargin: ratio(net, revenue),
      // Nợ vay/VCSH cần tách nợ chịu lãi; chưa đối chiếu mã chỉ tiêu nên để trống.
      debtToEquity: null,
      currentAssetsVnd: value('currentAssets', year),
      currentLiabilitiesVnd: value('currentLiabilities', year),
      longTermLiabilitiesVnd: value('longTermLiabilities', year),
      equityVnd: value('equity', year),
      minorityEquityVnd: minorityEquity,
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
    source: 'FIREANT_VIETCAP',
    fetchedAt: now,
    verification: 'provider_reported',
    businessType: 1,
    supported: true,
    currentShares: ratios.at(-1)?.shares ?? null,
    annual: annual.slice(-8),
    notices: [
      'Nguồn dự phòng FireAnt (KBS không khả dụng): CĐKT/KQKD/LCTT năm từ FireAnt; EPS cơ bản và ngày công bố từ Vietcap, đã đối chiếu LNST công ty mẹ hai nguồn.',
      'Giả định: FireAnt không ghi trạng thái kiểm toán; BCTC năm công bố sau kỳ được coi là bản đã kiểm toán, hợp nhất khi có lợi ích CĐ không kiểm soát. Chưa đối chiếu PDF.',
      'BVPS = (vốn chủ sở hữu − lợi ích CĐ không kiểm soát) / số cổ phiếu cuối năm Vietcap.',
      'FCF = CFO − toàn bộ tiền đầu tư TSCĐ/tài sản dài hạn; không phải FCFE hoặc Owner Earnings đã xác minh.',
      'Nợ vay/VCSH chưa có ở nguồn dự phòng.',
      ...(ratios.length === 0 ? ['Chưa có ROIC/số cổ phiếu từ Vietcap.'] : []),
      ...notices,
    ],
  };
}
export class FireantProvider {
  private http: ProviderHttp;
  constructor(
    private token: string,
    transport: typeof fetch = fetch,
    options: HttpOptions = {
      ...defaultHttpOptions,
      retries: 1,
      timeoutMs: 12000,
    },
  ) {
    // JWT tối thiểu có 3 phần; không log, không đưa vào lỗi.
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
      throw new Error('FIREANT_API_TOKEN không hợp lệ');
    this.http = new ProviderHttp('FireAnt', transport, options);
  }
  fetchFinancials(symbol: string, now = new Date()): Promise<FinancialData> {
    symbolValue(symbol);
    return this.http.cached('fireant:' + symbol, 86400000, async () => {
      const stamp = now.toISOString();
      const year = Number(stamp.slice(0, 4));
      const auth = { Authorization: 'Bearer ' + this.token };
      const reports = {} as Record<FireantReportType, Map<number, FireantRow>>;
      for (const type of [1, 2, 4] as const)
        reports[type] = parseFireantReport(
          await this.http.request(
            `https://restv2.fireant.vn/symbols/${symbol}/full-financial-reports?type=${type}&year=${year}&quarter=0&limit=4`,
            auth,
          ),
          type,
        );
      const vciIncome = parseBackupStatement(
        await this.http.request(
          `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/${symbol}/financial-statement?section=INCOME_STATEMENT`,
        ),
        symbol,
      );
      let ratios: unknown = null,
        organCode = symbol;
      try {
        ratios = await this.http.request(
          `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/${symbol}/statistics-financial`,
        );
        if (vciOrganCodes(ratios).some((code) => code !== symbol))
          organCode = parseVciCompany(
            await this.http.request(
              `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/${symbol}`,
            ),
            symbol,
          );
      } catch {
        ratios = null;
      }
      const data = fireantFinancialData(
        symbol,
        reports,
        vciIncome,
        ratios,
        stamp,
        organCode,
      );
      data.documentEvidence = documentEvidenceFor(symbol, stamp);
      return data;
    });
  }
}
