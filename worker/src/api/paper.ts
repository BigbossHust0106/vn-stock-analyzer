import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { serviceDatabase } from '../jobs/database';
import { boundedText } from '../../../modules/news/rss';
import { liveQuotes } from '../live-quotes';
import { vietnamDate } from '../../../modules/market/calendar';
import {
  portfolioValue,
  type PaperWallet,
  type PaperPosition,
} from '../../../modules/paper/accounting';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const messages: Record<string, string> = {
  PAPER_INVALID:
    'Kiểm tra số vốn, số lượng và phí. Số lượng phải là bội số của 100.',
  PAPER_WALLET_MISSING: 'Không tìm thấy ví thử của bạn.',
  PAPER_REQUEST_REUSED:
    'Mã yêu cầu đã dùng cho nội dung khác. Hãy làm mới và kiểm tra lịch sử.',
  PAPER_WALLET_LIMIT: 'Mỗi tài khoản có tối đa 20 ví thử.',
  PAPER_NO_PRICE:
    'Chưa có giá dương hợp lệ cho mã này. Có thể thử chế độ giá đã lưu.',
  PAPER_OLD_PRICE:
    'Giá đã quá cũ để mở giao dịch thử (tối đa 14 ngày với giá đã lưu).',
  PAPER_STOCK_MISSING: 'Mã không có trong danh mục đang hoạt động.',
  PAPER_TICK:
    'Giá nguồn không phù hợp bước giá của sàn; chưa thể mô phỏng ở giá này.',
  PAPER_RATE_LIMIT: 'Quá nhiều thao tác đầu tư thử. Đợi một phút rồi thử lại.',
  PAPER_QUOTE_USED:
    'Giá này đã được dùng cho một giao dịch. Lấy giá mới để tiếp tục.',
  PAPER_QUOTE_EXPIRED: 'Giá xác nhận đã hết hạn 2 phút. Vui lòng lấy giá lại.',
  PAPER_ACCEPT_CACHED: 'Cần xác nhận dùng giá đã lưu cho giao dịch thử.',
  PAPER_INSUFFICIENT_CASH: 'Ví thử không đủ tiền để mua, bao gồm phí.',
  PAPER_INSUFFICIENT_SHARES: 'Không đủ cổ phiếu trong ví thử để bán.',
  PAPER_POSITION_LIMIT: 'Mỗi ví giữ tối đa 50 mã cùng lúc.',
};
export async function paperResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    ![
      '/v1/paper',
      '/v1/paper/wallets',
      '/v1/paper/quote',
      '/v1/paper/orders',
    ].includes(url.pathname)
  )
    return null;
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  };
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const token = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token) return reply({ error: 'Cần đăng nhập.' }, 401);
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: 'Chưa cấu hình đăng nhập.' }, 503);
  const db = createClient(
    env.SUPABASE_URL || deployment.supabaseUrl,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + token } },
    },
  );
  try {
    const auth = await db.auth.getUser(token);
    if (auth.error || !auth.data.user)
      return reply({ error: 'Phiên đăng nhập không hợp lệ.' }, 401);
    const owner = auth.data.user.id;
    if (request.method === 'GET' && url.pathname === '/v1/paper') {
      const wid = url.searchParams.get('wallet'),
        before = url.searchParams.get('before'),
        id = url.searchParams.get('id');
      if (
        (wid !== null && !uuid(wid)) ||
        (before === null) !== (id === null) ||
        (id !== null && !uuid(id)) ||
        (before !== null &&
          (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
            before,
          ) ||
            !Number.isFinite(Date.parse(before))))
      )
        return reply({ error: 'Bộ lọc ví không hợp lệ.' }, 400);
      const { data, error } = await db.rpc('paper_snapshot', {
        wallet: wid,
        before_time: before,
        before_id: id,
      });
      if (error) {
        if (error.message === 'PAPER_WALLET_MISSING')
          return reply({ error: messages.PAPER_WALLET_MISSING }, 404);
        throw Error('Read failed');
      }
      if (!data || typeof data !== 'object') throw Error('Read failed');
      return reply({
        ...data,
        valuation: data.wallet
          ? portfolioValue(
              data.wallet as PaperWallet,
              data.positions as PaperPosition[],
            )
          : null,
      });
    }
    if (request.method !== 'POST' || url.pathname === '/v1/paper')
      return reply({ error: 'Phương thức không được hỗ trợ.' }, 405);
    let raw: string;
    try {
      raw = await boundedText(new Response(request.body), 3000);
    } catch {
      return reply({ error: 'Yêu cầu quá lớn.' }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return reply({ error: 'Dữ liệu không hợp lệ.' }, 400);
    }
    if (!body || Array.isArray(body) || typeof body !== 'object')
      return reply({ error: 'Dữ liệu không hợp lệ.' }, 400);
    const keys = (allowed: string[]) =>
      Object.keys(body).every((k) => allowed.includes(k));
    const service = serviceDatabase(env);
    const result = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await service.rpc(name, args);
      if (error) {
        if (!Object.hasOwn(messages, error.message))
          return reply(
            {
              error:
                'Chưa xác nhận được kết quả. Kiểm tra lịch sử và thử lại cùng yêu cầu, không gửi lệnh mới.',
              code: 'PAPER_UNCONFIRMED',
            },
            503,
          );
        const code = Object.hasOwn(messages, error.message)
          ? error.message
          : 'PAPER_INVALID';
        return reply(
          { error: messages[code], code },
          code === 'PAPER_RATE_LIMIT'
            ? 429
            : code === 'PAPER_WALLET_MISSING'
              ? 404
              : 409,
        );
      }
      return reply({ data });
    };
    if (url.pathname.endsWith('/wallets')) {
      if (
        !keys(['name', 'capital', 'feeBps', 'taxBps', 'requestId']) ||
        typeof body.name !== 'string' ||
        !Number.isSafeInteger(body.capital) ||
        !Number.isInteger(body.feeBps) ||
        !Number.isInteger(body.taxBps) ||
        !uuid(body.requestId)
      )
        return reply({ error: messages.PAPER_INVALID }, 400);
      return await result('paper_create_wallet', {
        owner,
        label: body.name,
        capital: body.capital,
        fee: body.feeBps,
        tax: body.taxBps,
        request: body.requestId,
      });
    }
    if (url.pathname.endsWith('/orders')) {
      if (
        !keys([
          'walletId',
          'quoteId',
          'side',
          'quantity',
          'requestId',
          'acceptCached',
        ]) ||
        !uuid(body.walletId) ||
        !uuid(body.quoteId) ||
        !uuid(body.requestId) ||
        !['buy', 'sell'].includes(String(body.side)) ||
        !Number.isSafeInteger(body.quantity) ||
        typeof body.acceptCached !== 'boolean'
      )
        return reply({ error: messages.PAPER_INVALID }, 400);
      return await result('paper_execute_order', {
        owner,
        wallet: body.walletId,
        quote: body.quoteId,
        action: body.side,
        shares: body.quantity,
        request: body.requestId,
        accept_cached: body.acceptCached,
      });
    }
    if (
      !keys(['symbol', 'mode']) ||
      typeof body.symbol !== 'string' ||
      !/^[A-Z0-9]{3,12}$/.test(body.symbol) ||
      !['source', 'cached'].includes(String(body.mode))
    )
      return reply({ error: 'Chọn mã và nguồn giá hợp lệ.' }, 400);
    const { data: stock, error: stockError } = await db
      .from('stocks')
      .select('id,symbol')
      .eq('symbol', body.symbol)
      .eq('active', true)
      .maybeSingle();
    if (stockError) throw Error('Read failed');
    if (!stock) return reply({ error: messages.PAPER_STOCK_MISSING }, 404);
    let price: number | null = null,
      observed: string | null = null,
      day: string | null = null;
    if (body.mode === 'source') {
      try {
        const q = (await liveQuotes([stock.symbol])).find(
          (q) => q.symbol === stock.symbol,
        );
        if (
          q?.lastPriceVnd &&
          q.lastPriceVnd >= q.floorVnd &&
          q.lastPriceVnd <= q.ceilingVnd
        ) {
          price = q.lastPriceVnd;
          observed = q.fetchedAt;
        }
      } catch {
        return reply(
          {
            error:
              'Chưa đọc được VPS. Bạn có thể chủ động chọn giá đã lưu để luyện tập.',
          },
          503,
        );
      }
    } else {
      const q = await db
        .from('prices_current')
        .select('last_price_vnd,fetched_at')
        .eq('stock_id', stock.id)
        .maybeSingle();
      if (q.error) throw Error('Read failed');
      if (q.data && q.data.last_price_vnd > 0) {
        price = q.data.last_price_vnd;
        observed = q.data.fetched_at;
      } else {
        const bars = await db
          .from('prices_history')
          .select('close_vnd,fetched_at,session_date')
          .eq('stock_id', stock.id)
          .eq('source', 'VPS')
          .lt('session_date', vietnamDate(Date.now()))
          .order('session_date', { ascending: false })
          .limit(1);
        if (bars.error) throw Error('Read failed');
        const bar = bars.data?.[0];
        if (bar) {
          price = bar.close_vnd;
          observed = bar.fetched_at;
          day = bar.session_date;
        }
      }
    }
    if (!price || !observed || !Number.isSafeInteger(price))
      return reply({ error: messages.PAPER_NO_PRICE }, 409);
    return await result('paper_create_quote', {
      owner,
      sid: stock.id,
      price,
      observed,
      price_mode: body.mode,
      bar_day: day,
    });
  } catch {
    return reply(
      {
        error:
          'Chưa xử lý được ví thử. Hãy làm mới dữ liệu và kiểm tra lịch sử trước khi thử lại.',
      },
      503,
    );
  }
}
