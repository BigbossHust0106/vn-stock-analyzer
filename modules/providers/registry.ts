import { VpsProvider } from './vps-provider';
import { KbsProvider } from './kbs-provider';
import type { DataProvider } from './data-provider';

export interface ProviderConfig {
  FUNDAMENTALS_PROVIDER?: string;
  CATALOG_PROVIDER?: string;
  HISTORY_PROVIDER?: string;
  QUOTE_PROVIDER?: string;
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
    fundamentals: kbs,
    catalog: kbs,
    history: config.HISTORY_PROVIDER === 'kbs' ? kbs : vps,
    quotes: vps,
    profile: vps,
  };
}
