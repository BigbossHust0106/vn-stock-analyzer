export interface NewsSource {
  id: string;
  name: string;
  origin: string;
  feeds: string[];
  termsUrl: string;
  restricted: boolean;
}
export const newsSources: NewsSource[] = [
  {
    id: 'cafef',
    name: 'CafeF',
    origin: 'https://cafef.vn',
    feeds: [
      '/thi-truong-chung-khoan.rss',
      '/doanh-nghiep.rss',
      '/vi-mo-dau-tu.rss',
      '/tai-chinh-ngan-hang.rss',
    ],
    termsUrl: 'https://cafef.vn/rss.chn',
    restricted: false,
  },
  {
    id: 'vietstock',
    name: 'Vietstock',
    origin: 'https://vietstock.vn',
    feeds: [
      '/144/chung-khoan.rss',
      '/733/doanh-nghiep.rss',
      '/761/kinh-te/vi-mo.rss',
      '/2/hang-hoa.rss',
    ],
    termsUrl: 'https://vietstock.vn/rss',
    restricted: false,
  },
  {
    id: 'vneconomy',
    name: 'VnEconomy',
    origin: 'https://vneconomy.vn',
    feeds: ['/chung-khoan.rss', '/tai-chinh.rss', '/thi-truong.rss'],
    termsUrl: 'https://vneconomy.vn/rss.html',
    restricted: true,
  },
  {
    id: 'vnexpress',
    name: 'VnExpress Kinh doanh',
    origin: 'https://vnexpress.net',
    feeds: ['/rss/kinh-doanh.rss'],
    termsUrl: 'https://vnexpress.net/rss',
    restricted: true,
  },
];
export function enabledSource(source: NewsSource, permission?: string) {
  return (
    !source.restricted ||
    ['personal-nonprofit', 'licensed'].includes(permission ?? '')
  );
}
export const newsUserAgent =
  'VNStockAnalyzer/1.0 (+https://github.com/BigbossHust0106/vn-stock-analyzer; RSS-only)';
