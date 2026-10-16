export const agentModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const intents = [
  'stock',
  'compare',
  'watchlists',
  'create_list',
  'rename_list',
  'delete_list',
  'add_stock',
  'remove_stock',
  'edit_item',
  'create_alert',
  'delete_alert',
  'toggle_alert',
  'help',
  'clarify',
] as const;
export type Intent = (typeof intents)[number];
export interface AgentPlan {
  intent: Intent;
  symbols: string[];
  listId: string | null;
  name: string | null;
  notes: string | null;
  targetVnd: number | null;
  alertId: string | null;
  kind: 'buy_zone' | 'sell_zone' | 'stop_loss' | null;
  lowerVnd: number | null;
  upperVnd: number | null;
  enabled: boolean | null;
}
export const mutations = new Set<Intent>([
  'create_list',
  'rename_list',
  'delete_list',
  'add_stock',
  'remove_stock',
  'edit_item',
  'create_alert',
  'delete_alert',
  'toggle_alert',
]);
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function validPlan(v: unknown): v is AgentPlan {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as AgentPlan;
  const keys = [
    'intent',
    'symbols',
    'listId',
    'name',
    'notes',
    'targetVnd',
    'alertId',
    'kind',
    'lowerVnd',
    'upperVnd',
    'enabled',
  ];
  const text = (s: unknown, max: number) =>
    s === null || (typeof s === 'string' && s.length <= max);
  const money = (n: unknown) =>
    n === null ||
    (typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e12);
  if (
    Object.keys(p).some((k) => !keys.includes(k)) ||
    !intents.includes(p.intent) ||
    !Array.isArray(p.symbols) ||
    p.symbols.length > 3 ||
    !p.symbols.every(
      (s) => typeof s === 'string' && /^[A-Z0-9]{3,12}$/.test(s),
    ) ||
    new Set(p.symbols).size !== p.symbols.length ||
    !(p.listId === null || uuid(p.listId)) ||
    !(p.alertId === null || uuid(p.alertId)) ||
    !text(p.name, 120) ||
    !text(p.notes, 1000) ||
    !money(p.targetVnd) ||
    !money(p.lowerVnd) ||
    !money(p.upperVnd) ||
    !(p.enabled === null || typeof p.enabled === 'boolean') ||
    !(
      p.kind === null || ['buy_zone', 'sell_zone', 'stop_loss'].includes(p.kind)
    )
  )
    return false;
  if (
    [
      'stock',
      'compare',
      'add_stock',
      'remove_stock',
      'edit_item',
      'create_alert',
    ].includes(p.intent) &&
    p.symbols.length < 1
  )
    return false;
  if (p.intent === 'compare' && p.symbols.length < 2) return false;
  if (
    ['add_stock', 'remove_stock', 'edit_item', 'create_alert'].includes(
      p.intent,
    ) &&
    p.symbols.length !== 1
  )
    return false;
  if (['create_list', 'rename_list'].includes(p.intent) && !p.name?.trim())
    return false;
  if (
    [
      'rename_list',
      'delete_list',
      'add_stock',
      'remove_stock',
      'edit_item',
      'create_alert',
    ].includes(p.intent) &&
    !p.listId
  )
    return false;
  if (['toggle_alert', 'delete_alert'].includes(p.intent) && !p.alertId)
    return false;
  if (p.intent === 'toggle_alert' && p.enabled === null) return false;
  if (
    p.intent === 'create_alert' &&
    (!p.kind ||
      p.lowerVnd === null ||
      (p.kind === 'buy_zone'
        ? p.upperVnd === null || p.upperVnd < p.lowerVnd
        : p.upperVnd !== null))
  )
    return false;
  return true;
}
export interface AgentSource {
  label: string;
  url: string;
  receivedAt: string | null;
}
export interface AgentReply {
  text: string;
  sources: AgentSource[];
  proposal?: { id: string; summary: string; expiresAt: string; status: string };
  model?: string;
}
export const helpText =
  'Bạn có thể hỏi “Phân tích FPT”, “So sánh VNM và HPG”, “Xem watchlist”, “Tạo danh sách Dài hạn”, “Thêm FPT vào Dài hạn”, “Đặt giá mục tiêu FPT 58.000 VND”, hoặc “Cảnh báo cắt lỗ FPT dưới 55.000 VND”. Ghi rõ đơn vị giá VND và danh sách. Mỗi thao tác thay đổi cần bạn xem trước và xác nhận. Agent không đặt lệnh mua/bán.';

// Cloudflare JSON mode uses the raw JSON Schema, not OpenAI's name/schema wrapper.
export const planSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: [...intents] },
    symbols: { type: 'array', items: { type: 'string' } },
    listId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    targetVnd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    alertId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    kind: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    lowerVnd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    upperVnd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    enabled: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
  },
  required: [
    'intent',
    'symbols',
    'listId',
    'name',
    'notes',
    'targetVnd',
    'alertId',
    'kind',
    'lowerVnd',
    'upperVnd',
    'enabled',
  ],
};

// Copy literal user values for explicit create commands; never let the model
// shorten years, numeric suffixes, case or quoted names before confirmation.
export function bindLiteralName(plan: AgentPlan, message: string): AgentPlan {
  if (plan.intent !== 'create_list') return plan;
  const match = message
    .trim()
    .match(
      /^(?:hãy\s+)?tạo(?:\s+cho\s+tôi)?(?:\s+một)?\s+(?:danh\s+sách(?:\s+theo\s+dõi)?|watchlist)\s+(?:(?:có\s+)?tên(?:\s+là)?\s+)?(.+)$/iu,
    );
  if (!match) return plan;
  let name = match[1]!.trim();
  if (/^["“].*["”]$/u.test(name)) name = name.slice(1, -1).trim();
  else if (/\s+(?:và|rồi|sau đó)\s+/iu.test(name)) return plan;
  const result = { ...plan, name };
  if (!validPlan(result)) throw Error('AI_INVALID');
  return result;
}
