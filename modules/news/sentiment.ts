import {
  validAnalysis,
  isPromotional,
  type ClassifiedArticle,
} from './analysis';
import { duplicateTitle } from './rss';
export interface NewsScore {
  score: number | null;
  candidateCount?: number;
  coverage?: number;
  count: number;
  sourceCount: number;
  asOf: string;
  newestAt: string | null;
  links: { title: string; url: string; publishedAt: string }[];
  reason: string;
}
export function newsSentiment(
  articles: ClassifiedArticle[],
  symbol: string,
  asOf: string,
): NewsScore {
  const now = Date.parse(asOf),
    seen: ClassifiedArticle[] = [];
  if (Number.isFinite(now))
    for (const a of [...articles].sort((a, b) =>
      a.published_at.localeCompare(b.published_at),
    )) {
      const time = Date.parse(a.published_at),
        analyzed = Date.parse(a.analyzed_at ?? '');
      if (
        a.analysis_status !== 'ok' ||
        isPromotional(a) ||
        !validAnalysis(a.analysis, a) ||
        !a.analysis ||
        !a.symbols.includes(symbol) ||
        a.symbols.length !== 1 ||
        !Number.isFinite(time) ||
        !Number.isFinite(analyzed) ||
        time > now ||
        analyzed > now ||
        now - time > 7 * 86400000 ||
        seen.some(
          (x) =>
            x.id === a.id ||
            x.source_url === a.source_url ||
            duplicateTitle(x.title, a.title),
        )
      )
        continue;
      seen.push(a);
    }
  const relevant: ClassifiedArticle[] = [];
  for (const a of articles) {
    const time = Date.parse(a.published_at);
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(time) ||
      time > now ||
      now - time > 7 * 86400000 ||
      isPromotional(a) ||
      a.symbols.length !== 1 ||
      !a.symbols.includes(symbol)
    )
      continue;
    if (
      !relevant.some(
        (x) =>
          x.id === a.id ||
          x.source_url === a.source_url ||
          duplicateTitle(x.title, a.title),
      )
    )
      relevant.push(a);
  }
  const coverage = relevant.length ? seen.length / relevant.length : 0;
  let sum = 0,
    total = 0;
  for (const a of seen) {
    const age = (now - Date.parse(a.published_at)) / 86400000,
      w =
        { high: 3, medium: 2, low: 1 }[a.analysis!.impact] *
        Math.pow(0.5, age / 3);
    sum += { positive: 1, neutral: 0, negative: -1 }[a.analysis!.sentiment] * w;
    total += w;
  }
  return {
    score:
      total > 0 && coverage === 1
        ? Math.round((50 + (50 * sum) / total) * 1000) / 1000
        : null,
    count: seen.length,
    candidateCount: relevant.length,
    coverage,
    sourceCount: new Set(seen.map((a) => a.source_id)).size,
    asOf,
    newestAt:
      seen
        .map((a) => a.published_at)
        .sort()
        .at(-1) ?? null,
    links: seen.map((a) => ({
      title: a.title,
      url: a.source_url,
      publishedAt: a.published_at,
    })),
    reason:
      total > 0 && coverage === 1
        ? 'Sắc thái tin chỉ gắn một mã, 7 ngày; ảnh hưởng 3/2/1, trọng số giảm một nửa mỗi 3 ngày. Đây là mô hình, không dự báo lợi suất.'
        : `không đủ dữ liệu: đã phân tích ${seen.length}/${relevant.length} tin trực tiếp một mã trong 7 ngày; không dùng tập phân tích còn thiếu để chấm điểm.`,
  };
}
