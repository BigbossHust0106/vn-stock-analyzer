import type { RssArticle } from './rss';
import type { ClassifiedArticle } from './analysis';
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
const newsText = (a: Pick<RssArticle, 'title' | 'excerpt'>) =>
  a.title + ' ' + a.excerpt;
export function isPromotional(a: Pick<RssArticle, 'title'>) {
  return /uu dai|co hoi nhan|san qua|trung thuong|nhan iphone|tang iphone|qua tang/.test(
    fold(a.title),
  );
}
export function factorApplies(
  a: Pick<
    ClassifiedArticle,
    'title' | 'excerpt' | 'symbols' | 'sectors' | 'factors'
  >,
  symbol: string,
  sector: string | null,
  factor: string,
) {
  if (isPromotional(a) || !a.factors.includes(factor)) return false;
  if (factor === 'sector') return Boolean(sector && a.sectors.includes(sector));
  if (factor === 'corporate') return a.symbols.includes(symbol);
  if (factor === 'foreign' || factor === 'liquidity')
    return (
      a.symbols.includes(symbol) ||
      a.symbols.length === 0 ||
      /vn-index|toan thi truong|toan san|hai san|ba san|tren hose|tren hnx/.test(
        fold(newsText(a)),
      )
    );
  return factor === 'macro';
}

// Explicit ticker matches first; generic market stories require deliberate opt-in.
export function selectStockNews<
  T extends Pick<
    ClassifiedArticle,
    'title' | 'symbols' | 'sectors' | 'published_at'
  >,
>(
  rows: T[],
  symbol: string,
  sector: string | null,
  includeContext = false,
): T[] {
  return rows
    .filter(
      (a) =>
        !isPromotional(a) &&
        (a.symbols.includes(symbol) ||
          (includeContext &&
            (a.symbols.length === 0 ||
              (!!sector && a.sectors.includes(sector))))),
    )
    .sort(
      (a, b) =>
        Number(b.symbols.includes(symbol)) -
          Number(a.symbols.includes(symbol)) ||
        b.published_at.localeCompare(a.published_at),
    );
}
