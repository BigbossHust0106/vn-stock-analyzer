const inflight = new Map<string, Promise<Response>>();
// Only public market data. Auth, account data, proposals and notifications never enter this cache.
export function cacheableMarketPath(path: string) {
  return (
    [
      '/v1/backtest',
      '/v1/stocks',
      '/v1/catalog',
      '/v1/rankings',
      '/v1/news',
    ].includes(path) ||
    /^\/v1\/(?:stocks|financials)\/[A-Z0-9]{3,12}$/.test(path)
  );
}
export async function publicReadCache(
  request: Request,
  context: Pick<ExecutionContext, 'waitUntil'> | undefined,
  load: () => Promise<Response>,
) {
  const url = new URL(request.url);
  if (
    !context ||
    typeof caches === 'undefined' ||
    request.method !== 'GET' ||
    request.headers.has('Authorization') ||
    request.headers.has('Cookie') ||
    url.searchParams.get('refresh') === '1' ||
    !cacheableMarketPath(url.pathname)
  )
    return load();
  url.searchParams.sort();
  url.searchParams.set('_edge_schema', 'disk-io-v1');
  const key = new Request(url.toString());
  const pending = inflight.get(key.url);
  if (pending) return (await pending).clone();
  const task = (async () => {
    let cache: Cache | undefined, hit: Response | undefined;
    try {
      cache = await caches.open('vn-stock-public-io-v1');
      hit = await cache.match(key);
    } catch {
      /* DB read remains available if edge cache fails. */
    }
    if (hit) {
      const response = new Response(hit.body, hit);
      response.headers.set('X-Data-Cache', 'HIT');
      return response;
    }
    const response = await load();
    if (
      response.status === 200 &&
      !response.headers.has('Set-Cookie') &&
      /^public, max-age=\d+$/.test(response.headers.get('Cache-Control') ?? '')
    ) {
      context.waitUntil(
        cache
          ? cache.put(key, response.clone()).catch(() => undefined)
          : Promise.resolve(),
      );
      response.headers.set('X-Data-Cache', 'MISS');
    }
    return response;
  })();
  if (inflight.size < 100) inflight.set(key.url, task);
  try {
    return (await task).clone();
  } finally {
    if (inflight.get(key.url) === task) inflight.delete(key.url);
  }
}
