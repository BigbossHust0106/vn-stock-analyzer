// Explicit allowlist: never cache sessions, watchlists, notifications or status.
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
    !['/v1/backtest', '/v1/stocks'].includes(url.pathname)
  )
    return load();
  url.searchParams.sort();
  url.searchParams.set('_edge_schema', 'phase8-v1');
  const key = new Request(url.toString());
  let cache: Cache | undefined;
  let hit: Response | undefined;
  try {
    cache = await caches.open('vn-stock-public-phase8');
    hit = await cache.match(key);
  } catch {
    /* Cache failure does not hide a database result. */
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
}
