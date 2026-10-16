import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse } from 'miniflare';
it('workerd enforces native rate binding before cached backtest; cache HIT avoids another DB call', async () => {
  const bundle = await build({
    stdin: {
      contents: `import {apiRateLimit} from './worker/src/api/rate-limit';import {publicReadCache} from './worker/src/api/public-cache';import {backtestResponse} from './worker/src/api/backtest';export default {async fetch(r,env,ctx){const denied=await apiRateLimit(r,env);if(denied)return denied;return publicReadCache(r,ctx,()=>backtestResponse(r,{...env,SUPABASE_URL:'https://db.example.test',SUPABASE_PUBLISHABLE_KEY:'fixture'}) );}}`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  let reads = 0;
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'backtest-runtime',
          compatibilityDate: '2026-10-12',
          compatibilityFlags: ['nodejs_compat'],
          env: {
            API_RATE_LIMIT: {
              type: 'rate-limit',
              namespace: 'phase8-test',
              simple: { limit: 2, period: 60 },
            },
          },
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
            handler: async (request) => {
              expect(new URL(request.url).pathname).toBe(
                '/rest/v1/rpc/backtest_history',
              );
              reads++;
              return RuntimeResponse.json([]);
            },
          },
        },
      },
    ],
  });
  try {
    const url = 'http://worker.test/v1/backtest';
    const headers = { 'CF-Connecting-IP': '192.0.2.8' };
    const first = await mf.dispatchFetch(url, { headers });
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Data-Cache')).toBe('MISS');
    await first.text();
    // Workerd dispatchFetch drains waitUntil before the next request in this fixture.
    const second = await mf.dispatchFetch(url, { headers });
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Data-Cache')).toBe('HIT');
    await second.text();
    expect(reads).toBe(1);
    const third = await mf.dispatchFetch(url, { headers });
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBe('60');
    expect(reads).toBe(1);
    const authenticated = await mf.dispatchFetch(url, {
      headers: {
        'CF-Connecting-IP': '192.0.2.9',
        Authorization: 'Bearer fixture',
      },
    });
    expect(authenticated.status).toBe(200);
    await authenticated.text();
    expect(authenticated.headers.get('X-Data-Cache')).toBeNull();
    expect(reads).toBe(2);
  } finally {
    await mf.dispose();
  }
});
