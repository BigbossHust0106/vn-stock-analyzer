import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
it('workerd: paper owner is verified by Auth; prices cannot be supplied by client; private snapshots', async () => {
  const owner = '91000000-0000-0000-0000-000000000001',
    wallet = '91000000-0000-0000-0000-000000000002',
    quote = '91000000-0000-0000-0000-000000000003',
    requestId = '91000000-0000-0000-0000-000000000004';
  const bundle = await build({
    stdin: {
      contents: `import {paperResponse} from './worker/src/api/paper'; export default {async fetch(request){return await paperResponse(request,{SUPABASE_URL:'https://db.example.test',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-not-real'})??new Response('Not found',{status:404});}}`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const writes: unknown[] = [];
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'paper-runtime',
          compatibilityDate: '2026-10-12',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'test.js',
            modules: {
              'test.js': { type: 'esm', contents: bundle.outputFiles[0]!.text },
            },
          },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (req) => {
              const path = new URL(req.url).pathname;
              if (path === '/auth/v1/user') return Response.json({ id: owner });
              if (path === '/rest/v1/rpc/paper_execute_order') {
                writes.push(await req.json());
                return Response.json({ id: 'receipt' });
              }
              if (path === '/rest/v1/rpc/paper_snapshot')
                return Response.json({
                  wallet: null,
                  wallets: [],
                  positions: [],
                  trades: [],
                  next: null,
                });
              throw Error('Unexpected destination');
            },
          },
        },
      },
    ],
  });
  const headers = {
    Authorization: 'Bearer fixture.jwt.token',
    'Content-Type': 'application/json',
  };
  try {
    expect((await mf.dispatchFetch('http://worker.test/v1/paper')).status).toBe(
      401,
    );
    const body = {
      walletId: wallet,
      quoteId: quote,
      side: 'buy',
      quantity: 100,
      requestId,
      acceptCached: true,
    };
    expect(
      (
        await mf.dispatchFetch('http://worker.test/v1/paper/orders', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, price_vnd: 1, owner_id: owner }),
        })
      ).status,
    ).toBe(400);
    const ok = await mf.dispatchFetch('http://worker.test/v1/paper/orders', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(ok.status).toBe(200);
    expect(writes).toEqual([
      {
        owner,
        wallet,
        quote,
        action: 'buy',
        shares: 100,
        request: requestId,
        accept_cached: true,
      },
    ]);
    expect(
      (
        await mf.dispatchFetch('http://worker.test/v1/paper/orders', {
          method: 'POST',
          headers,
          body: 'x'.repeat(3001),
        })
      ).status,
    ).toBe(413);
    const snapshot = await mf.dispatchFetch('http://worker.test/v1/paper', {
      headers,
    });
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get('cache-control')).toBe('private, no-store');
    expect(await snapshot.json()).toMatchObject({
      wallet: null,
      valuation: null,
    });
    expect(
      (
        await mf.dispatchFetch('http://worker.test/v1/paper?wallet=invalid', {
          headers,
        })
      ).status,
    ).toBe(400);
  } finally {
    await mf.dispose();
  }
});
