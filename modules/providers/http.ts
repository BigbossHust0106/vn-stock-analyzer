export interface HttpOptions {
  ttlMs: number;
  minIntervalMs: number;
  retries: number;
  retryDelayMs: number;
  timeoutMs: number;
}
export const defaultHttpOptions: HttpOptions = {
  ttlMs: 15000,
  minIntervalMs: 1000,
  retries: 2,
  retryDelayMs: 500,
  timeoutMs: 25000,
};

export class ProviderHttp {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  private cache = new Map<string, { expires: number; data: unknown }>();
  constructor(
    private label: string,
    private transport: typeof fetch = fetch,
    private options = defaultHttpOptions,
  ) {
    if (
      !Object.values(options).every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isInteger(options.retries) ||
      options.retries > 5 ||
      options.timeoutMs <= 0
    )
      throw new Error('Cấu hình retry/cache không hợp lệ');
  }
  cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const found = this.cache.get(key);
      if (found && found.expires > Date.now())
        return structuredClone(found.data) as T;
      const data = await load();
      for (const [name, entry] of this.cache)
        if (entry.expires <= Date.now()) this.cache.delete(name);
      if (this.cache.size >= 100)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + ttl, data });
      return structuredClone(data);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  // `headers` dùng cho nguồn cần xác thực; lỗi không bao giờ chứa URL/header.
  async request(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      const wait = Math.max(
        0,
        this.options.minIntervalMs - (Date.now() - this.lastRequest),
      );
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequest = Date.now();
      let response: Response;
      try {
        // Workers fetch requires globalThis as receiver and does not support redirect:error.
        response = await this.transport.call(globalThis, url, {
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: 'manual',
          headers: {
            'User-Agent': 'vn-stock-analyzer/0.2 data-provider',
            ...headers,
          },
        });
      } catch {
        if (attempt === this.options.retries)
          throw new Error(`Không kết nối được ${this.label}`);
        await this.backoff(attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === this.options.retries)
          throw new Error(`${this.label} HTTP ${response.status}`);
        const header = response.headers.get('Retry-After');
        const seconds = header === null ? NaN : Number(header);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : header
            ? Date.parse(header) - Date.now()
            : 0;
        if (delay > 30000)
          throw new Error(`${this.label} yêu cầu retry ở job sau`);
        await this.backoff(
          attempt,
          Number.isFinite(delay) ? Math.max(0, delay) : 0,
        );
        continue;
      }
      if (!response.ok)
        throw new Error(`${this.label} HTTP ${response.status}`);
      try {
        return await response.json();
      } catch {
        throw new Error(`${this.label} JSON không hợp lệ`);
      }
    }
    throw new Error('Không có dữ liệu');
  }
  private async backoff(attempt: number, delay = 0) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(delay, this.options.retryDelayMs * 2 ** attempt),
      ),
    );
  }
  get quoteTtl() {
    return this.options.ttlMs;
  }
}
