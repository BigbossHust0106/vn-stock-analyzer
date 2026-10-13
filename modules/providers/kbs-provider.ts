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
import { vietnamDate } from '../market/calendar';

export class KbsProvider implements DataProvider {
  private http: ProviderHttp;
  constructor(
    transport: typeof fetch = fetch,
    options: HttpOptions = defaultHttpOptions,
  ) {
    this.http = new ProviderHttp('KBS', transport, options);
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
          isFinal: b.sessionDate < vietnamDate(Date.parse(fetchedAt)),
        }));
    });
  }
}
