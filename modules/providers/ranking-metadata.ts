import { ProviderHttp } from './http';
import { symbolValue } from './market-schema';
import { validSourceDate } from './source-evidence';
import type { RankingEvent } from '../scoring/rankings';
const base = 'https://kbbuddywts.kbsec.com.vn/iis-server/investment';
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
export function parseSectors(value: unknown): { code: number; name: string }[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    !value.every(
      (s) =>
        record(s) &&
        Number.isSafeInteger(s.code) &&
        typeof s.name === 'string' &&
        s.name.length > 0 &&
        s.name.length <= 120,
    )
  )
    throw new Error('Danh mục ngành KBS không hợp lệ');
  return value as { code: number; name: string }[];
}
export function parseSectorStocks(value: unknown, name: string): string[] {
  if (!record(value) || value.name !== name || !Array.isArray(value.stocks))
    throw new Error('Ngành KBS sai cấu trúc');
  return value.stocks.map((s) => {
    if (!record(s) || typeof s.sb !== 'string')
      throw new Error('Mã ngành không hợp lệ');
    return symbolValue(s.sb);
  });
}
export function parseCorporateEvents(
  value: unknown,
  symbol: string,
  source: string,
  asOf: string,
): RankingEvent[] {
  if (
    !record(value) ||
    value.successful !== true ||
    value.status !== 200 ||
    !record(value.data) ||
    !Array.isArray(value.data.content)
  )
    throw new Error('Sự kiện Vietcap không hợp lệ');
  const events: RankingEvent[] = [];
  for (const row of value.data.content) {
    if (
      !record(row) ||
      row.ticker !== symbol ||
      typeof row.eventCode !== 'string'
    )
      throw new Error('Sự kiện sai mã');
    // Chỉ eventCode đã quan sát thật. Không diễn giải "other" thành ngày công bố KQKD.
    const kind =
      row.eventCode === 'DIV'
        ? 'dividend'
        : ['AGME', 'EGME'].includes(row.eventCode)
          ? 'agm'
          : null;
    if (!kind) continue;
    const date = kind === 'dividend' ? row.exrightDate : row.issueDate;
    const publication = row.publicDate;
    if (
      typeof date !== 'string' ||
      typeof publication !== 'string' ||
      typeof row.eventTitleVi !== 'string'
    )
      continue;
    const day = date.slice(0, 10),
      known = publication.slice(0, 10);
    if (
      !validSourceDate(day) ||
      !validSourceDate(known) ||
      Date.parse(known + 'T00:00:00+07:00') > Date.parse(asOf)
    )
      continue;
    events.push({
      event_date: day,
      kind,
      title: row.eventTitleVi.slice(0, 300),
      source_url: source,
      known_at: known + 'T00:00:00+07:00',
    });
  }
  return [
    ...new Map(
      events.map((event) => [
        event.kind + event.event_date + event.source_url,
        event,
      ]),
    ).values(),
  ];
}
export function parseReferencePrices(
  value: unknown,
): { symbol: string; reference_vnd: number }[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Danh mục tham chiếu KBS không đầy đủ');
  return value
    .filter(
      (row) =>
        record(row) &&
        row.type === 'stock' &&
        ['HOSE', 'HNX', 'UPCOM'].includes(String(row.exchange)),
    )
    .map((row) => {
      if (
        !record(row) ||
        typeof row.symbol !== 'string' ||
        typeof row.re !== 'number' ||
        !Number.isFinite(row.re) ||
        row.re <= 0 ||
        row.re >= 1e12
      )
        throw new Error('Giá tham chiếu KBS không hợp lệ');
      return { symbol: symbolValue(row.symbol), reference_vnd: row.re };
    });
}
export class RankingMetadataProvider {
  private http: ProviderHttp;
  constructor(transport: typeof fetch = fetch) {
    this.http = new ProviderHttp('KBS/Vietcap metadata', transport);
  }
  async referencePrices() {
    const rows = parseReferencePrices(
      await this.http.request(base + '/stock/search/data'),
    );
    if (rows.length < 100)
      throw new Error('Danh mục tham chiếu KBS không đầy đủ');
    return {
      rows,
      source: base + '/stock/search/data',
      fetchedAt: new Date().toISOString(),
    };
  }
  async sectors() {
    return this.http.cached('sectors', 86400000, async () => {
      const result: { name: string; symbols: string[]; source: string }[] = [];
      for (const sector of parseSectors(
        await this.http.request(base + '/sector/all'),
      )) {
        const source = base + `/sector/stock?code=${sector.code}&l=1`;
        result.push({
          name: sector.name,
          symbols: parseSectorStocks(
            await this.http.request(source),
            sector.name,
          ),
          source,
        });
      }
      return result;
    });
  }
  async events(symbol: string, asOf: string) {
    symbolValue(symbol);
    const year = asOf.slice(0, 4);
    const date = `${Number(year) + 1}1231`;
    const source = `https://iq.vietcap.com.vn/api/iq-insight-service/v1/events?ticker=${symbol}&fromDate=${year}0101&toDate=${date}&eventCode=DIV,AGME,EGME&page=0&size=100`;
    return this.http.cached(source, 86400000, async () =>
      parseCorporateEvents(
        await this.http.request(source),
        symbol,
        source,
        asOf,
      ),
    );
  }
}
