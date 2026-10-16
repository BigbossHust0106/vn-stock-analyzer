import { createClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import deployment from '../../../config/public-deployment.json';
import { validatedSymbols } from '../../../modules/providers/vps-provider';
import { liveQuotes, persistQuotes, quoteRow } from '../live-quotes';
export async function quotesResponse(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/quotes') return null;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  let symbols: string[];
  try {
    symbols = validatedSymbols(
      (url.searchParams.get('symbols') ?? '').split(','),
    );
  } catch {
    return Response.json(
      { error: 'Cần 1–50 mã hợp lệ, ngăn cách bằng dấu phẩy' },
      { status: 400, headers },
    );
  }
  if (!env.SUPABASE_PUBLISHABLE_KEY)
    return Response.json(
      { error: 'Nguồn dữ liệu chưa được cấu hình' },
      { status: 503, headers },
    );
  const base = env.SUPABASE_URL || deployment.supabaseUrl;
  const db = createClient(base, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await db
      .from('stocks')
      .select('symbol,prices_current(*)')
      .eq('active', true)
      .in('symbol', symbols);
    if (error || !data) throw Error('Read failed');
    let state = 'unavailable',
      persisted = false;
    let latest = new Map<string, ReturnType<typeof quoteRow>>();
    if (data.length) {
      try {
        const fresh = await liveQuotes(data.map((s) => String(s.symbol)));
        latest = new Map(fresh.map((q) => [q.symbol, quoteRow(q)]));
        state = 'source_response';
        if (env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            await persistQuotes(
              createClient(base, env.SUPABASE_SERVICE_ROLE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false },
              }),
              fresh,
            );
            persisted = true;
          } catch {
            /* Fresh response is still usable; persistence failure is explicit. */
          }
        }
      } catch {
        state = 'source_unavailable';
      }
    }
    return Response.json(
      {
        data: data.map((row) => ({
          ...row,
          prices_current: latest.get(String(row.symbol)) ?? row.prices_current,
        })),
        refresh: {
          state,
          persisted,
          checkedAt: new Date().toISOString(),
          sourceTimestamp: null,
          sessionVerified: false,
        },
        notice:
          state === 'source_unavailable'
            ? 'VPS tạm gián đoạn; giữ snapshot cũ và thời điểm nhận gốc. Sẽ tự thử lại.'
            : 'Tự lấy phản hồi VPS; thời điểm nhận không phải timestamp sàn. Không xác nhận giá đang giao dịch.',
        disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Không đọc được nguồn dữ liệu' },
      { status: 502, headers },
    );
  }
}
