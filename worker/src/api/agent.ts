import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { boundedText } from '../../../modules/news/rss';
import { agentModel, mutations, helpText } from '../../../modules/agent/plan';
import { interpret } from '../agent/model';
import { personalContext, preview, listPersonal } from '../agent/actions';
import { research } from '../agent/research';
const errors: Record<string, string> = {
  AI_SCHEMA_REJECTED:
    'Cloudflare chưa chấp nhận cấu trúc phản hồi AI. Chưa áp dụng thao tác.',
  AI_PROVIDER_QUOTA: 'Cloudflare AI đang giới hạn quota. Hãy thử lại sau.',
  AI_PROVIDER_AUTH:
    'Cloudflare chưa cấp quyền gọi model này. Quản trị viên cần kiểm tra Workers AI.',
  AI_PROVIDER_FAILED: 'Không gọi được Cloudflare AI. Chưa áp dụng thao tác.',

  NOT_FOUND: 'Không tìm thấy đối tượng trong tài khoản của bạn.',
  STOCK_NOT_FOUND: 'Không tìm thấy mã active.',
  ITEM_REQUIRED: 'Hãy thêm mã vào danh sách trước khi tạo cảnh báo hoặc sửa.',
  ITEM_EXISTS: 'Mã đã có trong danh sách.',
  LIST_EXISTS: 'Tên danh sách đã tồn tại.',
  EXPIRED: 'Đề xuất đã hết hạn. Hãy gửi yêu cầu lại.',
  STALE_PROPOSAL:
    'Dữ liệu đã thay đổi từ lúc xem trước. Hãy yêu cầu bản xem trước mới.',
  RATE_LIMIT: 'Đã đạt giới hạn AI. Hãy thử lại sau.',
  AI_TIMEOUT: 'AI phản hồi chậm. Chưa có thay đổi nào được thực hiện.',
  AI_INVALID: 'AI chưa hiểu đủ rõ. Hãy ghi rõ mã, tên danh sách và đơn vị VND.',
};
export async function agentResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/v1/agent') return null;
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { headers, status });
  if (!['GET', 'POST'].includes(request.method))
    return reply({ error: 'Chỉ hỗ trợ GET/POST' }, 405);
  const token = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token) return reply({ error: 'Cần đăng nhập' }, 401);
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: 'Chưa cấu hình đăng nhập' }, 503);
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + token } },
    },
  );
  let stage = 'auth';
  try {
    const { data: user, error } = await db.auth.getUser(token);
    if (error || !user.user)
      return reply({ error: 'Phiên đăng nhập không hợp lệ' }, 401);
    if (request.method === 'GET')
      return reply({
        available: Boolean(env.AI),
        model: agentModel,
        help: helpText,
        privacy:
          'Cloudflare AI nhận câu hỏi, tên/ID danh sách, mã theo dõi và cấu hình cảnh báo để diễn giải. Token không gửi cho AI. Hội thoại chỉ giữ trong bộ nhớ trang, không lưu localStorage. Đề xuất thao tác lưu riêng trong tài khoản để xác nhận, hết hạn sau10 phút.',
      });
    let body: unknown;
    try {
      body = JSON.parse(await boundedText(new Response(request.body), 10000));
    } catch {
      return reply({ error: 'Yêu cầu không hợp lệ hoặc quá lớn' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return reply({ error: 'Yêu cầu không hợp lệ' }, 400);
    const b = body as Record<string, unknown>;
    if (b.op === 'confirm' || b.op === 'cancel') {
      if (
        typeof b.id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(b.id) ||
        Object.keys(b).some((k) => !['op', 'id'].includes(k))
      )
        return reply({ error: 'Đề xuất không hợp lệ' }, 400);
      const { data, error: e } = await db.rpc('resolve_agent_action', {
        proposal: b.id,
        apply: b.op === 'confirm',
      });
      if (e) throw Error(e.message);
      return reply({
        text:
          data.status === 'applied'
            ? 'Đã áp dụng thao tác.'
            : 'Đề xuất đã hủy.',
        sources: [],
        resolution: data,
      });
    }
    if (
      b.op !== 'chat' ||
      !Array.isArray(b.messages) ||
      b.messages.length < 1 ||
      b.messages.length > 6 ||
      !b.messages.every(
        (m) => typeof m === 'string' && m.trim().length > 0 && m.length <= 1500,
      ) ||
      Object.keys(b).some((k) => !['op', 'messages'].includes(k))
    )
      return reply({ error: 'Gửi tối đa6 câu hỏi, mỗi câu1500 ký tự.' }, 400);
    if (!env.AI)
      return reply(
        {
          error:
            'AI chưa sẵn sàng trên Worker. Quản trị viên cần cấu hình Workers AI binding.',
        },
        503,
      );
    stage = 'quota';
    const { data: allowed, error: quotaError } = await db.rpc(
      'claim_agent_request',
    );
    if (quotaError) throw Error('QUOTA_UNAVAILABLE');
    if (allowed !== true) return reply({ error: errors.RATE_LIMIT }, 429);
    stage = 'context';
    const context = await personalContext(db);
    stage = 'model';
    const plan = await interpret(env.AI, b.messages as string[], context);
    if (['stock', 'compare'].includes(plan.intent)) {
      stage = 'research';
      const writer = env.SUPABASE_SERVICE_ROLE_KEY
        ? createClient(
            env.SUPABASE_URL || deployment.supabaseUrl,
            env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false, autoRefreshToken: false } },
          )
        : undefined;
      return reply({
        ...(await research(db, plan.symbols, writer)),
        model: agentModel,
      });
    }
    if (plan.intent === 'watchlists')
      return reply({ ...(await listPersonal(db, context)), model: agentModel });
    stage = 'action';
    if (mutations.has(plan.intent))
      return reply({
        ...(await preview(db, plan, context)),
        model: agentModel,
      });
    return reply({
      text:
        plan.intent === 'clarify'
          ? 'Tôi chưa xác định rõ mã hoặc danh sách cần dùng. Hãy ghi rõ tên danh sách, mã cổ phiếu, thao tác và giá theo VND.\n' +
            helpText
          : helpText,
      sources: [],
      model: agentModel,
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    const known = errors[code];
    return reply(
      {
        error:
          known ??
          'Chưa thực hiện được yêu cầu. Không khẳng định thao tác đã thành công; kiểm tra dữ liệu hoặc thử lại.',
        code: known ? code : 'AGENT_UNAVAILABLE',
        stage,
        providerCode:
          e instanceof Error &&
          'providerCode' in e &&
          typeof e.providerCode === 'string' &&
          /^\d{4}$/.test(e.providerCode)
            ? e.providerCode
            : null,
      },
      code === 'NOT_FOUND'
        ? 404
        : code.startsWith('AI_PROVIDER') || code === 'AI_SCHEMA_REJECTED'
          ? 503
          : known
            ? 409
            : 503,
    );
  }
}
