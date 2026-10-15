import type { rankStock } from '../scoring/rankings';
import type { NewsScore } from './sentiment';
export type NewsBaseExplanation = Omit<
  ReturnType<typeof rankStock>[number]['explanation'],
  'components'
> & {
  quoteSource?: string;
  components: {
    key: string;
    weight: number;
    score: number | null;
    availableFraction: number;
  }[];
};
type BaseRow = Omit<ReturnType<typeof rankStock>[number], 'explanation'> & {
  explanation: NewsBaseExplanation;
};
export function validNewsWeight(weight: number) {
  return Number.isFinite(weight) && weight >= 0 && weight <= 0.3;
}
export function integrateNews(row: BaseRow, news: NewsScore, weight = 0.1) {
  if (!validNewsWeight(weight))
    throw Error('Trọng số tin tức phải từ 0 đến 30%');
  const base = row.explanation;
  const available =
    news.score !== null &&
    Number.isFinite(news.score) &&
    news.score >= 0 &&
    news.score <= 100 &&
    news.count > 0;
  const coverage =
    Math.round(
      (base.coverage * (1 - weight) + (available ? weight : 0)) * 1000,
    ) / 1000;
  const blockers = [
    ...base.rankingEligibility.blockers,
    ...(weight > 0 && !available
      ? ['Tâm lý tin tức: không đủ dữ liệu LLM hợp lệ trong 7 ngày.']
      : []),
  ];
  return {
    ...row,
    value:
      row.value === null
        ? null
        : Math.round(
            (row.value * (1 - weight) +
              (available ? news.score! * weight : 0)) *
              1000,
          ) / 1000,
    explanation: {
      ...base,
      modelVersion: 'top10-v1-news-v1',
      coverage,
      components: [
        ...base.components.map((c) => ({
          ...c,
          weight: c.weight * (1 - weight),
        })),
        {
          key: 'news',
          weight,
          score: available ? news.score : null,
          availableFraction: 1,
        },
      ],
      strategies: { ...base.strategies, news: available ? news.score : null },
      rankingEligibility: {
        ...base.rankingEligibility,
        eligible:
          base.rankingEligibility.eligible &&
          (weight === 0 || available) &&
          coverage === 1,
        blockers,
      },
      reasons: [
        ...base.reasons,
        `Tâm lý tin tức ${available ? news.score + '/100' : 'không đủ dữ liệu'}; trọng số ${Math.round(weight * 100)}%.`,
      ],
      newsIntegration: {
        baseValue: row.value,
        baseExplanation: base,
        news,
        weight,
      },
    },
  };
}
export function reweightNewsRow<
  T extends {
    stock_id: string;
    score: number | null;
    explanation: NewsBaseExplanation & {
      newsIntegration?: {
        baseValue: number | null;
        baseExplanation: NewsBaseExplanation;
        news: NewsScore;
      };
    };
  },
>(row: T, weight: number, asOf: string) {
  const previous = row.explanation.newsIntegration;
  const news = previous?.news;
  const fresh =
    news &&
    Number.isFinite(Date.parse(news.asOf)) &&
    Date.parse(news.asOf) <= Date.parse(asOf) &&
    Date.parse(asOf) - Date.parse(news.asOf) <= 3600000;
  const evidence: NewsScore = fresh
    ? news
    : {
        score: null,
        count: 0,
        sourceCount: 0,
        asOf,
        newestAt: null,
        links: [],
        reason:
          'không đủ dữ liệu: snapshot tin tức quá hạn hoặc chưa được phân tích.',
      };
  const mixed = integrateNews(
    {
      stock_id: row.stock_id,
      horizon: 'day',
      value: previous ? previous.baseValue : row.score,
      insufficient_reason: null,
      inputs_as_of: asOf,
      explanation: previous?.baseExplanation ?? row.explanation,
    },
    evidence,
    weight,
  );
  return {
    ...row,
    score: mixed.value,
    explanation: {
      ...mixed.explanation,
      ...(row.explanation.quoteSource
        ? { quoteSource: row.explanation.quoteSource }
        : {}),
    },
  };
}
