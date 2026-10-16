import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentPlan, AgentReply } from '../../../modules/agent/plan';
export interface AgentContext {
  lists: { id: string; name: string }[];
  items: { watchlist_id: string; stocks: unknown }[];
  rules: {
    id: string;
    watchlist_id: string;
    stock_id: string;
    kind: string;
    lower_vnd: number | null;
    upper_vnd: number | null;
    enabled: boolean;
    symbol: string;
    config_version: number;
  }[];
}
export async function personalContext(
  db: SupabaseClient,
): Promise<AgentContext> {
  const [l, r, items] = await Promise.all([
    db.from('watchlists').select('id,name').order('created_at').limit(101),
    db
      .from('watchlist_alert_rules')
      .select(
        'id,watchlist_id,stock_id,kind,lower_vnd,upper_vnd,enabled,config_version',
      )
      .limit(201),
    db
      .from('watchlist_items')
      .select('watchlist_id,stock_id,stocks(symbol)')
      .limit(501),
  ]);
  if (l.error || r.error || items.error)
    throw Error('PERSONAL_DATA_UNAVAILABLE');
  if (l.data.length > 100 || r.data.length > 200 || items.data.length > 500)
    throw Error('CONTEXT_TOO_LARGE');
  return {
    lists: l.data,
    rules: r.data.map((rule) => ({
      ...rule,
      symbol:
        (
          items.data.find((i) => i.stock_id === rule.stock_id)
            ?.stocks as unknown as { symbol: string } | null
        )?.symbol ?? 'Mã chưa rõ',
    })),
    items: items.data,
  };
}
export async function preview(
  db: SupabaseClient,
  p: AgentPlan,
  context: AgentContext,
): Promise<AgentReply> {
  const action: Record<string, unknown> = { type: p.intent };
  let list = context.lists.find((l) => l.id === p.listId);
  let stock: { id: string; symbol: string } | null = null;
  if (
    ['add_stock', 'remove_stock', 'edit_item', 'create_alert'].includes(
      p.intent,
    )
  ) {
    const { data, error } = await db
      .from('stocks')
      .select('id,symbol')
      .eq('symbol', p.symbols[0]!)
      .eq('active', true)
      .maybeSingle();
    if (error || !data) throw Error('STOCK_NOT_FOUND');
    stock = data;
  }
  if (p.alertId) {
    const rule = context.rules.find((r) => r.id === p.alertId);
    if (!rule) throw Error('NOT_FOUND');
    action.alertId = rule.id;
    list = context.lists.find((l) => l.id === rule.watchlist_id);
    action.stockId = rule.stock_id;
    const found = await db
      .from('stocks')
      .select('id,symbol')
      .eq('id', rule.stock_id)
      .maybeSingle();
    if (found.error || !found.data) throw Error('NOT_FOUND');
    stock = found.data;
  }
  if (list) action.listId = list.id;
  if (stock) action.stockId = stock.id;
  const currency = (n: number | null) =>
    n === null ? 'không đặt' : n.toLocaleString('vi-VN') + ' VND';
  let expectedItem:
    { notes: string; target_price_vnd: number | null } | undefined;
  let summary = '';
  switch (p.intent) {
    case 'create_list':
      action.name = p.name!.trim();
      summary = `Tạo danh sách “${action.name}”.`;
      break;
    case 'rename_list':
      action.name = p.name!.trim();
      summary = `Đổi tên “${list?.name}” thành “${action.name}”.`;
      break;
    case 'delete_list':
      summary = `Xóa danh sách “${list?.name}”, toàn bộ mã, ghi chú và cảnh báo liên quan.`;
      break;
    case 'add_stock':
      summary = `Thêm ${stock?.symbol} vào “${list?.name}”.`;
      break;
    case 'remove_stock':
      summary = `Xóa ${stock?.symbol} khỏi “${list?.name}”, kèm ghi chú và cảnh báo của mã trong danh sách này.`;
      break;
    case 'edit_item': {
      const { data, error } = await db
        .from('watchlist_items')
        .select('notes,target_price_vnd')
        .eq('watchlist_id', list?.id ?? '')
        .eq('stock_id', stock?.id ?? '')
        .maybeSingle();
      if (error || !data) throw Error('ITEM_REQUIRED');
      expectedItem = data;
      action.notes = p.notes ?? data.notes;
      action.targetVnd = p.targetVnd ?? data.target_price_vnd;
      summary = `Sửa ${stock?.symbol} trong “${list?.name}”: giá mục tiêu ${currency(action.targetVnd as number | null)}; ghi chú “${action.notes}”.`;
      break;
    }
    case 'create_alert':
      action.kind = p.kind;
      action.lowerVnd = p.lowerVnd;
      action.upperVnd = p.upperVnd;
      summary = `Tạo cảnh báo ${p.kind === 'buy_zone' ? 'vùng mua' : p.kind === 'sell_zone' ? 'vùng bán' : 'cắt lỗ'} ${stock?.symbol} trong “${list?.name}”: ${currency(p.lowerVnd)}${p.upperVnd !== null ? ' đến ' + currency(p.upperVnd) : ''}. Chỉ thông báo trong ứng dụng; không đặt lệnh.`;
      break;
    case 'delete_alert':
      summary = `Xóa cảnh báo ${stock?.symbol} (${context.rules.find((r) => r.id === p.alertId)?.kind}, ngưỡng ${currency(context.rules.find((r) => r.id === p.alertId)?.lower_vnd ?? null)}) trong “${list?.name}”.`;
      break;
    case 'toggle_alert':
      action.enabled = p.enabled;
      summary = `${p.enabled ? 'Bật' : 'Tắt'} cảnh báo ${stock?.symbol} (${context.rules.find((r) => r.id === p.alertId)?.kind}, ngưỡng ${currency(context.rules.find((r) => r.id === p.alertId)?.lower_vnd ?? null)}) trong “${list?.name}”.`;
      break;
    default:
      throw Error('INVALID_ACTION');
  }
  if (p.intent !== 'create_list' && !list) throw Error('NOT_FOUND');
  const { data, error } = await db.rpc('prepare_agent_action', {
    a: action,
    description: summary,
  });
  if (error) throw Error(error.message);
  // The preview description must match the same state captured by the RPC,
  // including edits made while the model was interpreting the request.
  if (list) {
    const snapshot = await db
      .from('agent_proposals')
      .select('before_state')
      .eq('id', data.id)
      .single();
    if (snapshot.error || !snapshot.data)
      throw Error('PERSONAL_DATA_UNAVAILABLE');
    const state = snapshot.data.before_state;
    const rule = p.alertId
      ? context.rules.find((r) => r.id === p.alertId)
      : null;
    if (
      state.list?.name !== list.name ||
      (expectedItem &&
        (state.item?.notes !== expectedItem.notes ||
          state.item?.target_price_vnd !== expectedItem.target_price_vnd)) ||
      (rule && state.rule?.config_version !== rule.config_version)
    ) {
      await db.rpc('resolve_agent_action', { proposal: data.id, apply: false });
      throw Error('STALE_PROPOSAL');
    }
  }
  return {
    text: 'Đây là bản xem trước. Chưa có dữ liệu nào được thay đổi. Kiểm tra mã, danh sách, ngưỡng giá VND rồi chọn Xác nhận hoặc Hủy.',
    sources: [],
    proposal: data,
  };
}
export async function listPersonal(
  db: SupabaseClient,
  c: AgentContext,
): Promise<AgentReply> {
  const { data, error } = await db
    .from('watchlist_items')
    .select('watchlist_id,notes,target_price_vnd,stocks(symbol)')
    .limit(501);
  if (error || data.length > 500) throw Error('PERSONAL_DATA_UNAVAILABLE');
  const text = c.lists
    .map(
      (l) =>
        `${l.name}\n${
          data
            .filter((i) => i.watchlist_id === l.id)
            .map((i) => {
              const s = i.stocks as unknown as { symbol: string };
              return `• ${s.symbol}: giá mục tiêu ${i.target_price_vnd === null ? 'chưa đặt' : Number(i.target_price_vnd).toLocaleString('vi-VN') + ' VND'}; ghi chú: ${i.notes || 'chưa có'}`;
            })
            .join('\n') || 'Chưa có mã.'
        }`,
    )
    .join('\n\n');
  return {
    text:
      (text || 'Bạn chưa có danh sách theo dõi.') +
      '\n\nCảnh báo:\n' +
      (c.rules
        .map(
          (r) =>
            `• ${r.symbol}: ${r.kind}, ${r.lower_vnd ?? '—'}${r.upper_vnd !== null ? '–' + r.upper_vnd : ''} VND; ${r.enabled ? 'đang bật' : 'đang tắt'}`,
        )
        .join('\n') || 'Chưa có cảnh báo.'),
    sources: [
      { label: 'Quản lý watchlist', url: '/watchlists', receivedAt: null },
      { label: 'Quản lý cảnh báo', url: '/alerts', receivedAt: null },
    ],
  };
}
