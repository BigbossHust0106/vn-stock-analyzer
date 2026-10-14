import { documentEvidenceFor } from './document-evidence';
import {
  parseKbsReport,
  financialData,
  type ReportType,
} from './financial-schema';
import type { FinancialData } from './financial-types';
import type {
  DataProvider,
  Exchange,
  StockInfo,
  CurrentQuote,
  DailyBar,
} from './data-provider';
import { ProviderHttp, defaultHttpOptions, type HttpOptions } from './http';
import { parseKbsStocks, symbolValue, historyRange } from './market-schema';
import { parseKbsDailyEvidence } from './source-evidence';

export class KbsProvider implements DataProvider {
  private http: ProviderHttp;
  constructor(
    transport: typeof fetch = fetch,
    options: HttpOptions = defaultHttpOptions,
  ) {
    this.http = new ProviderHttp('KBS', transport, options);
  }
  async fetchFinancials(symbol: string): Promise<FinancialData> {
    symbolValue(symbol);
    return this.http.cached('financials:' + symbol, 86400000, async () => {
      const now = new Date().toISOString();
      const reports: Record<ReportType, ReturnType<typeof parseKbsReport>> = {
        KQKD: [],
        CDKT: [],
        LCTT: [],
        CSTC: [],
      };
      const missing: string[] = [];
      for (const type of Object.keys(reports) as ReportType[]) {
        for (const page of [1, 2]) {
          const url = new URL(
            `https://kbbuddywts.kbsec.com.vn/iis-server/investment/stock/finance-info/${symbol}`,
          );
          for (const [key, value] of Object.entries({
            page: String(page),
            pageSize: '4',
            type,
            unit: '1000',
            termtype: '1',
            languageid: '1',
          }))
            url.searchParams.set(key, value);
          let payload: unknown;
          try {
            payload = await this.http.request(url.href);
          } catch {
            missing.push(
              `Nguồn ${type} không khả dụng; các trường còn thiếu giữ null.`,
            );
            break;
          }
          const parsed = parseKbsReport(payload, type, now);
          reports[type].push(...parsed);
          if (parsed.length < 4) break;
        }
      }
      let ratios: unknown = null;
      try {
        ratios = await this.http.request(
          `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/${symbol}/statistics-financial`,
        );
      } catch {
        /* Source capability unavailable; no invented values. */
      }
      const data = financialData(symbol, reports, ratios, now);
      data.documentEvidence = documentEvidenceFor(symbol, now);
      data.notices.push(...missing);
      return data;
    });
  }
  async fetchStocks(exchange?: Exchange): Promise<StockInfo[]> {
    const data = await this.http.cached('catalog', 86400000, async () =>
      parseKbsStocks(
        await this.http.request(
          'https://kbbuddywts.kbsec.com.vn/iis-server/investment/stock/search/data',
        ),
        new Date().toISOString(),
      ),
    );
    if (!data.length)
      throw new Error('KBS không có cổ phiếu thuộc sàn Việt Nam');
    return exchange ? data.filter((s) => s.exchange === exchange) : data;
  }
  async fetchProfile(symbol: string): Promise<StockInfo> {
    symbolValue(symbol);
    const found = (await this.fetchStocks()).find((s) => s.symbol === symbol);
    if (!found) throw new Error('Không tìm thấy mã');
    return found;
  }
  async fetchQuotes(_symbols: readonly string[]): Promise<CurrentQuote[]> {
    void _symbols;
    throw new Error(
      'KBS quotes chưa có contract đơn vị khả dụng; cấu hình QUOTE_PROVIDER=vps',
    );
  }
  fetchHistory(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    symbolValue(symbol);
    historyRange(from, to);
    const date = (s: string) => s.split('-').reverse().join('-');
    const url = new URL(
      `https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/${symbol}/data_day`,
    );
    url.searchParams.set('sdate', date(from));
    url.searchParams.set('edate', date(to));
    return this.http.cached(url.href, 900000, async () => {
      const payload = await this.http.request(url.href);
      const fetchedAt = new Date().toISOString();
      return parseKbsDailyEvidence(payload, symbol)
        .filter((b) => b.sessionDate >= from && b.sessionDate <= to)
        .map((b) => ({
          ...b,
          source: 'KBS' as const,
          volumeUnit: 'shares' as const,
          fetchedAt,
          isFinal: false,
          finality: 'unverified' as const,
        }))
        .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    });
  }
}
