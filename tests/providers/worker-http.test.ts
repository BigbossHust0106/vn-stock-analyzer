import { expect, it, vi } from 'vitest';
import { ProviderHttp, defaultHttpOptions } from '../../modules/providers/http';

const options = { ...defaultHttpOptions, minIntervalMs: 0, retries: 0 };
it('transport tuân thủ receiver và redirect thực tế của Workers', async () => {
  const transport = vi.fn(function (
    this: unknown,
    _url: RequestInfo | URL,
    init?: RequestInit,
  ) {
    // Cloudflare probe thật: receiver sai -> Illegal invocation; redirect:error -> Invalid redirect value.
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    if (init?.redirect !== 'manual')
      throw new TypeError('Invalid redirect value');
    return Promise.resolve(Response.json({ ok: true }));
  });
  const http = new ProviderHttp('probe', transport, options);
  await expect(http.request('https://example.test/data')).resolves.toEqual({
    ok: true,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('không đi theo redirect của nguồn tới hostname khác', async () => {
  const transport = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://other.example/data' },
      });
    },
  );
  await expect(
    new ProviderHttp('probe', transport, options).request(
      'https://example.test/data',
    ),
  ).rejects.toThrow('probe HTTP 302');
  expect(transport).toHaveBeenCalledTimes(1);
});
