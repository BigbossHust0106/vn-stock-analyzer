export interface PublicConnectionConfig {
  workerUrl: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

export interface ConnectionCheck {
  name: string;
  ok: boolean;
  message: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

const publishable = /^sb_publishable_[A-Za-z0-9_-]+$/;

export async function checkConnections(
  config: PublicConnectionConfig,
  transport: typeof fetch = fetch,
): Promise<ConnectionCheck[]> {
  async function check(
    name: string,
    action: () => Promise<string>,
  ): Promise<ConnectionCheck> {
    try {
      return { name, ok: true, message: await action() };
    } catch (error) {
      return {
        name,
        ok: false,
        message:
          error instanceof CheckError
            ? error.message
            : 'Không kết nối được. Kiểm tra mạng và quyền truy cập dịch vụ.',
      };
    }
  }

  async function request(
    baseUrl: string,
    path: string,
    headers?: HeadersInit,
  ): Promise<unknown> {
    if (!validUrl(baseUrl)) throw new CheckError('URL dịch vụ không hợp lệ.');
    const response = await transport(new URL(path, baseUrl), {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      ...(headers ? { headers } : {}),
    });
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // Không hiển thị HTML lỗi hoặc phản hồi có thể chứa credential.
      }
      if (record(body) && body.code === 'PGRST205')
        throw new CheckError(
          'Chưa tìm thấy bảng dữ liệu. Cần áp dụng migration và kiểm tra Data API.',
        );
      throw new CheckError(`Dịch vụ trả lỗi HTTP ${response.status}.`);
    }
    return response.json();
  }

  return Promise.all([
    check('Workers API', async () => {
      const body = await request(config.workerUrl, '/health');
      if (!record(body) || body.status !== 'ok')
        throw new CheckError('Phản hồi kiểm tra API không hợp lệ.');
      return 'Đã kết nối.';
    }),
    check('Supabase', async () => {
      let url = config.supabaseUrl;
      let key = config.supabasePublishableKey;
      if (!url || !key) {
        const body = await request(config.workerUrl, '/v1/public-config');
        if (
          !record(body) ||
          typeof body.supabaseUrl !== 'string' ||
          typeof body.supabasePublishableKey !== 'string'
        )
          throw new CheckError('Cấu hình công khai chưa sẵn sàng.');
        url = body.supabaseUrl;
        key = body.supabasePublishableKey;
      }
      if (!publishable.test(key))
        throw new CheckError('Browser cần publishable key hợp lệ.');
      // sb_publishable_* không phải JWT: gửi apikey, không gửi Bearer key.
      for (const path of [
        '/rest/v1/stocks?select=symbol&limit=1',
        '/rest/v1/prices_current?select=stock_id&limit=1',
        '/rest/v1/trading_sessions?select=session_date&limit=1',
      ]) {
        const body = await request(url, path, { apikey: key });
        if (!Array.isArray(body))
          throw new CheckError('Phản hồi cơ sở dữ liệu không hợp lệ.');
      }
      return 'Đã kết nối và đọc được các bảng dữ liệu công khai.';
    }),
    check('Giá hiện tại qua Worker', async () => {
      const body = await request(config.workerUrl, '/v1/quotes?symbols=ACB');
      if (!record(body) || !Array.isArray(body.data))
        throw new CheckError('Phản hồi dữ liệu giá không hợp lệ.');
      function hasSnapshot(value: unknown): boolean {
        return (
          record(value) &&
          typeof value.fetched_at === 'string' &&
          Number.isFinite(Date.parse(value.fetched_at)) &&
          typeof value.last_price_vnd === 'number' &&
          Number.isFinite(value.last_price_vnd) &&
          value.last_price_vnd > 0
        );
      }
      const hasQuote = body.data.some((row: unknown) => {
        if (!record(row) || row.symbol !== 'ACB') return false;
        // Quan hệ một-một của PostgREST trả object; chấp nhận cả array có kiểm tra.
        return Array.isArray(row.prices_current)
          ? row.prices_current.some(hasSnapshot)
          : hasSnapshot(row.prices_current);
      });
      return hasQuote
        ? 'Đọc được snapshot ACB; xem fetched_at trước khi sử dụng.'
        : 'Đã kết nối, chưa có snapshot ACB.';
    }),
  ]);
}

class CheckError extends Error {}
