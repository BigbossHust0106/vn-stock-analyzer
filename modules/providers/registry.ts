import { VpsProvider } from './vps-provider';
import { KbsProvider } from './kbs-provider';
import type { DataProvider } from './data-provider';
import { FireantProvider } from './fireant-provider';
import type { FinancialData } from './financial-types';

// KBS là nguồn chính. FireAnt chỉ dùng khi KBS lỗi hoặc không có kỳ năm hợp lệ;
// không trộn số liệu hai nguồn trong một snapshot.
export class FallbackFundamentals implements DataProvider {
  constructor(
    private primary: DataProvider,
    private fallback: Pick<FireantProvider, 'fetchFinancials'>,
  ) {}
  async fetchFinancials(symbol: string): Promise<FinancialData> {
    let primary: FinancialData | null = null;
    try {
      primary = await this.primary.fetchFinancials(symbol);
      if (!primary.supported || primary.annual.length) return primary;
    } catch {
      /* Thử nguồn dự phòng bên dưới. */
    }
    try {
      const backup = await this.fallback.fetchFinancials(symbol);
      if (backup.annual.length) return backup;
    } catch {
      /* Cả hai nguồn lỗi: báo lỗi chung, giữ snapshot cũ ở tầng gọi. */
    }
    if (primary) return primary;
    throw new Error('KBS và FireAnt đều chưa trả BCTC hợp lệ');
  }
  fetchQuotes(symbols: readonly string[]) {
    return this.primary.fetchQuotes(symbols);
  }
  fetchStocks(exchange?: Parameters<DataProvider['fetchStocks']>[0]) {
    return this.primary.fetchStocks(exchange);
  }
  fetchProfile(symbol: string) {
    return this.primary.fetchProfile(symbol);
  }
  fetchHistory(symbol: string, from: string, to: string) {
    return this.primary.fetchHistory(symbol, from, to);
  }
}

export interface ProviderConfig {
  FUNDAMENTALS_PROVIDER?: string;
  CATALOG_PROVIDER?: string;
  HISTORY_PROVIDER?: string;
  QUOTE_PROVIDER?: string;
  // Secret Worker; không đặt NEXT_PUBLIC, không log.
  FIREANT_API_TOKEN?: string;
}
// Token sai định dạng không được làm hỏng toàn bộ provider: chỉ tắt dự phòng.
function fundamentalsWithFallback(
  kbs: DataProvider,
  token: string | undefined,
  transport: typeof fetch,
): DataProvider {
  if (!token) return kbs;
  try {
    return new FallbackFundamentals(kbs, new FireantProvider(token, transport));
  } catch {
    console.warn('FIREANT_API_TOKEN sai định dạng; chỉ dùng KBS.');
    return kbs;
  }
}
export function providers(
  config: ProviderConfig = {},
  transport: typeof fetch = fetch,
): {
  fundamentals: DataProvider;
  catalog: DataProvider;
  history: DataProvider;
  quotes: DataProvider;
  profile: DataProvider;
} {
  const vps = new VpsProvider(transport),
    kbs = new KbsProvider(transport);
  if (
    (config.FUNDAMENTALS_PROVIDER ?? 'kbs') !== 'kbs' ||
    (config.CATALOG_PROVIDER ?? 'kbs') !== 'kbs' ||
    !['vps', 'kbs'].includes(config.HISTORY_PROVIDER ?? 'vps') ||
    (config.QUOTE_PROVIDER ?? 'vps') !== 'vps'
  )
    throw new Error('Cấu hình provider không được hỗ trợ');
  return {
    fundamentals: fundamentalsWithFallback(
      kbs,
      config.FIREANT_API_TOKEN,
      transport,
    ),
    catalog: kbs,
    history: config.HISTORY_PROVIDER === 'kbs' ? kbs : vps,
    quotes: vps,
    profile: vps,
  };
}
