import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { it, expect, vi } from 'vitest';
const code = readFileSync('web/public/sw.js', 'utf8');
function serviceWorker() {
  const listeners = new Map<string, (e: unknown) => void>();
  const store = {
    addAll: vi
      .fn<(paths: string[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    put: vi.fn(),
  };
  const caches = {
    open: vi.fn(async () => store),
    match: vi.fn(async () => new Response('PUBLIC OFFLINE PAGE')),
    keys: vi.fn(async () => [
      'vn-stock-pwa-old',
      'vn-stock-pwa-v1',
      'other-application',
    ]),
    delete: vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(true),
  };
  const network = vi.fn<typeof fetch>(
    async () => new Response('FRESH NETWORK'),
  );
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, callback: (e: unknown) => void) =>
      listeners.set(name, callback),
  };
  runInNewContext(code, { self, caches, fetch: network, URL, Response });
  async function lifecycle(name: string) {
    const jobs: Promise<unknown>[] = [];
    listeners.get(name)!({ waitUntil: (p: Promise<unknown>) => jobs.push(p) });
    await Promise.all(jobs);
  }
  function request(url: string, method = 'GET', mode = 'cors') {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request: { url, method, mode },
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    });
    return response;
  }
  return { self, store, caches, network, lifecycle, request, listeners };
}
it('install/activate only cache public offline assets and delete own older caches, never auto-activate an update', async () => {
  const s = serviceWorker();
  await s.lifecycle('install');
  expect(s.store.addAll.mock.calls[0]?.[0]).toEqual([
    '/offline.html',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
  ]);
  expect(s.self.skipWaiting).not.toHaveBeenCalled();
  await s.lifecycle('activate');
  expect(s.caches.delete.mock.calls.map((c) => c[0])).toEqual([
    'vn-stock-pwa-old',
  ]);
  expect(s.self.clients.claim).toHaveBeenCalledOnce();
  s.listeners.get('message')!({ data: { type: 'ACTIVATE_UPDATE' } });
  expect(s.self.skipWaiting).toHaveBeenCalledOnce();
});
it('market/personal APIs, OAuth, external Supabase and mutations are never intercepted or written to cache', () => {
  const s = serviceWorker();
  for (const [url, method, mode] of [
    ['https://app.test/v1/stocks/VNM', 'GET', 'cors'],
    ['https://app.test/v1/watchlists', 'GET', 'navigate'],
    ['https://app.test/v1/watchlists', 'POST', 'cors'],
    [
      'https://app.test/auth/callback?code=sensitive-example',
      'GET',
      'navigate',
    ],
    ['https://db.example.test/auth/v1/token', 'POST', 'cors'],
    ['https://db.example.test/rest/v1/watchlists', 'GET', 'cors'],
  ] as const)
    expect(s.request(url, method, mode)).toBeUndefined();
  expect(s.caches.match).not.toHaveBeenCalled();
  expect(s.caches.open).not.toHaveBeenCalled();
  expect(s.store.put).not.toHaveBeenCalled();
});
it('documents are network-first and never saved; failed navigation gets only the public offline page', async () => {
  const s = serviceWorker();
  expect(
    await (
      await s.request('https://app.test/watchlists', 'GET', 'navigate')!
    ).text(),
  ).toBe('FRESH NETWORK');
  expect(s.caches.match).not.toHaveBeenCalled();
  expect(s.store.put).not.toHaveBeenCalled();
  s.network.mockRejectedValue(new Error('offline'));
  expect(
    await (
      await s.request('https://app.test/watchlists', 'GET', 'navigate')!
    ).text(),
  ).toBe('PUBLIC OFFLINE PAGE');
  expect(s.caches.match).toHaveBeenCalledWith('/offline.html', {
    cacheName: 'vn-stock-pwa-v1',
  });
  expect(s.store.put).not.toHaveBeenCalled();
});
it('manifest identifies a standalone app with valid PNG dimensions, maskable safe background and no auth data', () => {
  const m = JSON.parse(readFileSync('web/public/manifest.webmanifest', 'utf8'));
  expect(m).toMatchObject({
    id: '/',
    scope: '/',
    start_url: '/?source=pwa',
    display: 'standalone',
    lang: 'vi',
  });
  for (const size of [32, 180, 192, 512]) {
    const png = readFileSync('web/public/icons/icon-' + size + '.png');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
  expect(
    m.icons.some((i: { purpose: string }) => i.purpose.includes('maskable')),
  ).toBe(true);
  expect(readFileSync('web/public/offline.html', 'utf8')).toContain(
    'Không có dữ liệu thị trường mới',
  );
});
