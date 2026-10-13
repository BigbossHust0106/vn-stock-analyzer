import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';

afterEach(() => vi.unstubAllGlobals());
it('API thị trường từ chối input lỗi và method ghi trước khi gọi nguồn', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const env = { SUPABASE_PUBLISHABLE_KEY: 'public-test-key' };
  for (const path of [
    '/v1/stocks?exchange=NYSE',
    '/v1/stocks?q=' + 'A'.repeat(81),
    '/v1/stocks/VNM%27',
    '/v1/stocks/VNM/extra',
  ]) {
    const r = await worker.fetch(
      new Request('https://example.test' + path),
      env,
    );
    expect(r.status).toBe(400);
  }
  const r = await worker.fetch(
    new Request('https://example.test/v1/stocks', { method: 'POST' }),
    env,
  );
  expect(r.status).toBe(405);
  expect(fetch).not.toHaveBeenCalled();
});
it('Mã không có trong catalog trả 404, không gọi API VPS tùy ý', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('null', { headers: { 'Content-Type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetch);
  const r = await worker.fetch(
    new Request('https://example.test/v1/stocks/ZZZ'),
    { SUPABASE_PUBLISHABLE_KEY: 'public-test-key' },
  );
  expect(r.status).toBe(404);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0]![0])).toContain('/rest/v1/stocks');
});
