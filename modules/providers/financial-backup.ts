import { ProviderHttp, defaultHttpOptions, type HttpOptions } from './http';
import { record, symbolValue } from './market-schema';
import { validSourceDate } from './source-evidence';
export const reportSections = [
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
  'CASH_FLOW',
] as const;
export type ReportSection = (typeof reportSections)[number];
export interface BackupPeriod {
  year: number;
  publicDate: string | null;
  fields: Record<string, number | null>;
}
export interface FinancialBackup {
  symbol: string;
  source: 'VIETCAP_REPORTS';
  fetchedAt: string;
  verification: 'raw_provider_only';
  usableForScoring: false;
  reports: Record<ReportSection, BackupPeriod[]>;
}
export interface FinancialReportsProvider {
  fetchFinancialReports(symbol: string): Promise<FinancialBackup>;
}
export function parseBackupStatement(
  payload: unknown,
  symbol: string,
): BackupPeriod[] {
  if (
    !record(payload) ||
    payload.successful !== true ||
    payload.status !== 200 ||
    !record(payload.data) ||
    !Array.isArray(payload.data.years)
  )
    throw Error(
      'Vietcap backup: thiếu data.years hoặc trạng thái nguồn không hợp lệ',
    );
  const seen = new Set<number>();
  return payload.data.years
    .map((row: unknown) => {
      if (
        !record(row) ||
        row.ticker !== symbol ||
        !Number.isInteger(row.yearReport) ||
        Number(row.yearReport) < 1990 ||
        Number(row.yearReport) > 2100 ||
        row.lengthReport !== 5 ||
        seen.has(Number(row.yearReport))
      )
        throw Error('Vietcap backup: sai mã/kỳ năm hoặc trùng kỳ');
      const year = Number(row.yearReport);
      seen.add(year);
      const fields: Record<string, number | null> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!/^(?:bs|is|cf|nos)[a-z]*\d+$/.test(key)) continue;
        if (
          value !== null &&
          (typeof value !== 'number' ||
            !Number.isFinite(value) ||
            Math.abs(value) > 1e18)
        )
          throw Error('Vietcap backup: trường ' + key + ' sai kiểu/giá trị');
        fields[key] = value as number | null;
      }
      if (!Object.keys(fields).length)
        throw Error('Vietcap backup: không có chỉ tiêu');
      const date =
        typeof row.publicDate === 'string' ? row.publicDate.slice(0, 10) : null;
      if (date !== null && (!validSourceDate(date) || date <= `${year}-12-31`))
        throw Error('Vietcap backup: ngày công bố không hợp lệ');
      return { year, publicDate: date, fields };
    })
    .sort((a, b) => a.year - b.year);
}
export class VietcapReportsProvider implements FinancialReportsProvider {
  private http: ProviderHttp;
  constructor(
    transport: typeof fetch = fetch,
    options: HttpOptions = {
      ...defaultHttpOptions,
      retries: 1,
      timeoutMs: 10000,
    },
  ) {
    this.http = new ProviderHttp('Vietcap reports', transport, options);
  }
  fetchFinancialReports(symbol: string): Promise<FinancialBackup> {
    symbolValue(symbol);
    return this.http.cached('reports:' + symbol, 86400000, async () => {
      const reports = {} as FinancialBackup['reports'];
      for (const section of reportSections) {
        const payload = await this.http.request(
          `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/${symbol}/financial-statement?section=${section}`,
        );
        reports[section] = parseBackupStatement(payload, symbol);
        if (!reports[section].length)
          throw Error('Vietcap backup: báo cáo rỗng, giữ bản dự phòng cũ');
      }
      return {
        symbol,
        source: 'VIETCAP_REPORTS',
        fetchedAt: new Date().toISOString(),
        verification: 'raw_provider_only',
        usableForScoring: false,
        reports,
      };
    });
  }
}
