import type { CatalogPage } from '../web/lib/market-client';
import { createClient } from '@supabase/supabase-js';
import { catalogResponse } from '../worker/src/api/catalog';
import { financialCatalog } from '../worker/src/financial-catalog';
import deployment from '../config/public-deployment.json';
const base = process.env.MARKET_APP_URL || deployment.workerUrl;
const c = (await (await fetch(base + '/v1/public-config')).json()) as {
  supabaseUrl: string;
  supabasePublishableKey: string;
};
function assert(v: unknown, message: string): asserts v {
  if (!v) throw Error(message);
}
async function read(query: string) {
  const req = new Request(base + '/v1/catalog?' + query);
  const r =
    process.env.CATALOG_DEPLOYED === 'true'
      ? await fetch(req)
      : await catalogResponse(req, {
          SUPABASE_URL: c.supabaseUrl,
          SUPABASE_PUBLISHABLE_KEY: c.supabasePublishableKey,
        });
  assert(r?.ok, 'catalog HTTP ' + r?.status);
  return (await r.json()) as CatalogPage;
}
const first = await read('financials=all&page=1'),
  second = await read('financials=all&page=2');
assert(first.counts.catalog > 1000, 'Market unexpectedly truncated');
assert(
  first.data.length === 24 && second.data.length === 24,
  'Pagination not 24',
);
assert(
  !first.data.some((a: { symbol: string }) =>
    second.data.some((b: { symbol: string }) => a.symbol === b.symbol),
  ),
  'Pages overlap',
);
const last = await read('financials=all&page=' + Math.ceil(first.total / 24));
assert(last.data.length > 0 && last.data.length <= 24, 'Last page missing');
const available = await read('financials=available&page=1');
assert(
  available.total > 32,
  'Financial coverage has not expanded beyond original 32',
);
const next = await read('financials=available&page=2');
assert(next.data.length > 0, 'Available data still hidden beyond first page');
for (const exchange of ['HOSE', 'HNX', 'UPCOM']) {
  const x = await read('financials=all&exchange=' + exchange);
  assert(
    x.data.length > 0 &&
      x.data.every((s: { exchange: string }) => s.exchange === exchange),
    'Wrong exchange ' + exchange,
  );
}
const exact = await read('q=FRT&financials=all');
assert(
  exact.data.some(
    (s: { symbol: string; financial_state: string }) =>
      s.symbol === 'FRT' && s.financial_state === 'available',
  ),
  'New symbol FRT not ready',
);
const missing = await read('financials=missing');
assert(
  missing.data.every(
    (s: { financial_state: string }) => s.financial_state === 'missing',
  ),
  'Missing filter incorrect',
);
const queue = await financialCatalog(
  createClient(c.supabaseUrl, c.supabasePublishableKey, {
    auth: { persistSession: false },
  }),
);
assert(
  queue.stocks.length === first.counts.catalog,
  'Financial queue does not cover real full catalog',
);
console.log(
  'CATALOG LIVE PASS:',
  JSON.stringify({
    mode:
      process.env.CATALOG_DEPLOYED === 'true'
        ? 'deployed'
        : 'local handler / real public DB',
    catalog: first.counts.catalog,
    withAnnual: available.total,
    lastPage: last.page,
    pages: Math.ceil(first.total / 24),
    queue: queue.stocks.length,
    financialSnapshots: queue.fetched.size,
  }),
);
