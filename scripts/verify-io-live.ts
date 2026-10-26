import deployment from '../config/public-deployment.json';
const base = process.env.MARKET_APP_URL || deployment.workerUrl;
for (const path of ['/v1/catalog?q=FRT', '/v1/financials/FRT']) {
  const u =
    base + path + (path.includes('?') ? '&' : '?') + 'ioProbe=' + Date.now();
  const first = await fetch(u, { signal: AbortSignal.timeout(45000) });
  if (!first.ok) throw Error('IO live HTTP ' + first.status);
  const body = await first.json();
  let hit = false;
  for (let n = 0; n < 3; n++) {
    await new Promise((r) => setTimeout(r, 700));
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('IO live HTTP ' + r.status);
    const next = await r.json();
    if (r.headers.get('X-Data-Cache') === 'HIT') {
      if (JSON.stringify(body) !== JSON.stringify(next))
        throw Error('Cached snapshot/timestamp changed');
      hit = true;
      break;
    }
  }
  if (!hit)
    throw Error('No edge cache HIT observed; do not claim backend reduction');
  console.log(
    'IO LIVE CACHE PASS:',
    path,
    first.headers.get('Cache-Control'),
    'MISS/read → HIT; same data/timestamps',
  );
}
console.log(
  'IO LIVE NOTE: no bulk load test, private mutation, or production Disk IO percentage measurement performed.',
);
