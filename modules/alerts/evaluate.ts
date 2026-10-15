import { validAnalysis, type ClassifiedArticle } from '../news/analysis';
export const alertLabels = {
  buy_zone: 'Chạm vùng mua',
  sell_zone: 'Chạm mức chốt lời',
  stop_loss: 'Chạm mức cắt lỗ',
  score_change: 'Điểm thay đổi lớn',
  important_news: 'Tin quan trọng',
} as const;
export type AlertKind = keyof typeof alertLabels;
export interface AlertRule {
  id: string;
  owner_id: string;
  watchlist_id: string;
  stock_id: string;
  kind: AlertKind;
  enabled: boolean;
  email_enabled: boolean;
  lower_vnd: number | null;
  upper_vnd: number | null;
  score_delta: number;
  horizon: 'day' | 'month' | 'quarter';
  config_version: number;
  created_at: string;
}
export interface AlertSnapshot {
  config?: number;
  active?: boolean;
  price?: number;
  priceAt?: string;
  score?: number;
  scoreAt?: string;
  newsAt?: string;
  newsId?: string;
}
export interface AlertEvent {
  key: string;
  title: string;
  body: string;
  source_url: string | null;
  evidence: Record<string, unknown>;
}
export interface AlertInputs {
  symbol: string;
  price: { value: number | null; asOf: string } | null;
  score: { value: number | null; asOf: string; complete: boolean } | null;
  news: ClassifiedArticle[];
  asOf: string;
}
const fresh = (value: string, now: number, maxAge: number) =>
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) <= now &&
  now - Date.parse(value) <= maxAge;
const money = (n: number) => n.toLocaleString('vi-VN') + ' VND';
const points = (n: number) =>
  n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
export function evaluateAlert(
  rule: AlertRule,
  previous: AlertSnapshot,
  input: AlertInputs,
) {
  const now = Date.parse(input.asOf),
    state: AlertSnapshot =
      previous.config === rule.config_version
        ? { ...previous }
        : { config: rule.config_version };
  const events: AlertEvent[] = [];
  if (!rule.enabled || !Number.isFinite(now))
    return {
      state,
      events,
      reason: 'Cảnh báo tắt hoặc thời gian không hợp lệ.',
    };
  if (['buy_zone', 'sell_zone', 'stop_loss'].includes(rule.kind)) {
    const p = input.price;
    if (
      !p ||
      p.value === null ||
      !Number.isFinite(p.value) ||
      p.value <= 0 ||
      p.value >= 1e12 ||
      !fresh(p.asOf, now, 15 * 60000)
    )
      return {
        state,
        events,
        reason:
          'không đủ dữ liệu: cần snapshot giá khớp VPS trong 15 phút; không dùng giá tham chiếu.',
      };
    if (state.priceAt && Date.parse(p.asOf) <= Date.parse(state.priceAt))
      return { state, events, reason: 'Snapshot đã kiểm tra.' };
    const lower = rule.lower_vnd,
      upper = rule.upper_vnd;
    if (
      lower === null ||
      !Number.isFinite(lower) ||
      lower <= 0 ||
      (rule.kind === 'buy_zone' &&
        (upper === null || !Number.isFinite(upper) || upper < lower))
    )
      return {
        state,
        events,
        reason: 'không đủ dữ liệu: vùng giá không hợp lệ.',
      };
    const active =
      rule.kind === 'buy_zone'
        ? p.value >= lower && p.value <= upper!
        : rule.kind === 'sell_zone'
          ? p.value >= lower
          : p.value <= lower;
    const crossed =
      rule.kind === 'buy_zone' &&
      state.price !== undefined &&
      state.priceAt !== undefined &&
      fresh(state.priceAt, now, 15 * 60000) &&
      ((state.price < lower && p.value > upper!) ||
        (state.price > upper! && p.value < lower));
    if ((active && !state.active) || crossed) {
      const title = alertLabels[rule.kind] + ' · ' + input.symbol;
      events.push({
        key: 'price:' + rule.config_version + ':' + p.asOf,
        title,
        body: `Snapshot VPS ${money(p.value)} ${crossed ? 'đã đi qua vùng giữa hai lần quan sát; không xác nhận đã có giao dịch tại vùng' : 'đang chạm/vượt mức theo dõi'}. Mức đã lưu: ${money(lower)}${rule.kind === 'buy_zone' ? '–' + money(upper!) : ''}. Nhận lúc ${new Date(p.asOf).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ Việt Nam).`,
        source_url: null,
        evidence: {
          priceVnd: p.value,
          quoteReceivedAt: p.asOf,
          previousPriceVnd: state.price ?? null,
          previousQuoteAt: state.priceAt ?? null,
          lowerVnd: lower,
          upperVnd: upper,
          snapshotOnly: true,
        },
      });
    }
    Object.assign(state, { active, price: p.value, priceAt: p.asOf });
  } else if (rule.kind === 'score_change') {
    const s = input.score;
    if (
      !s ||
      !s.complete ||
      s.value === null ||
      !Number.isFinite(s.value) ||
      s.value < 0 ||
      s.value > 100 ||
      !fresh(s.asOf, now, 36 * 3600000)
    )
      return {
        state,
        events,
        reason:
          'không đủ dữ liệu: điểm phải đầy đủ bằng chứng và không quá 36 giờ.',
      };
    if (state.scoreAt && Date.parse(s.asOf) <= Date.parse(state.scoreAt))
      return { state, events, reason: 'Điểm đã kiểm tra.' };
    if (
      state.score !== undefined &&
      Math.abs(s.value - state.score) >= rule.score_delta
    ) {
      events.push({
        key: 'score:' + rule.config_version + ':' + s.asOf,
        title: alertLabels.score_change + ' · ' + input.symbol,
        body: `Điểm ${rule.horizon === 'day' ? 'trong ngày' : rule.horizon === 'month' ? 'trong tháng' : 'trong quý'} từ ${points(state.score)} lên/xuống ${points(s.value)}/100; thay đổi ${points(s.value - state.score)} điểm, ngưỡng ${points(rule.score_delta)}. So sánh hai snapshot cùng khung điểm; dữ liệu và trọng số có thể làm điểm thay đổi.`,
        source_url: null,
        evidence: {
          previousScore: state.score,
          score: s.value,
          previousAt: state.scoreAt,
          scoreAt: s.asOf,
          horizon: rule.horizon,
        },
      });
    }
    Object.assign(state, { score: s.value, scoreAt: s.asOf });
  } else {
    const relevant = input.news
      .filter(
        (a) =>
          a.analysis_status === 'ok' &&
          validAnalysis(a.analysis, a) &&
          a.analysis?.impact === 'high' &&
          a.symbols.includes(input.symbol) &&
          Date.parse(a.published_at) >= Date.parse(rule.created_at) &&
          fresh(a.published_at, now, 7 * 86400000) &&
          a.analyzed_at &&
          fresh(a.analyzed_at, now, 7 * 86400000) &&
          (!state.newsAt ||
            a.analyzed_at > state.newsAt ||
            (a.analyzed_at === state.newsAt && a.id > (state.newsId ?? ''))),
      )
      .sort(
        (a, b) =>
          a.analyzed_at!.localeCompare(b.analyzed_at!) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 10);
    for (const a of relevant) {
      events.push({
        key: 'news:' + a.id,
        title: 'Tin quan trọng · ' + input.symbol,
        body: `${a.title}. Mô hình gắn mức ảnh hưởng cao; ${a.analysis!.summary}. Đây là nhãn từ mô tả RSS, không xác nhận hướng giá của mã.`,
        source_url: a.source_url,
        evidence: {
          articleId: a.id,
          publishedAt: a.published_at,
          analyzedAt: a.analyzed_at,
          model: a.model,
          sentiment: a.analysis!.sentiment,
        },
      });
      state.newsAt = a.analyzed_at!;
      state.newsId = a.id;
    }
  }
  return {
    state,
    events,
    reason: events.length
      ? 'Đã phát hiện điều kiện.'
      : 'Chưa có thay đổi vượt ngưỡng.',
  };
}
