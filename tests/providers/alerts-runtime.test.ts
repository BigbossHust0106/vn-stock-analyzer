import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
it('workerd: notification test xác thực owner từ Auth, không từ JSON; chặn body lớn và anonymous', async () => {
  const owner = '71000000-0000-0000-0000-000000000001',
    stock = '71000000-0000-0000-0000-000000000003',
    list = '71000000-0000-0000-0000-000000000004';
  const bundle = await build({
    stdin: {
      contents: `import {notificationsResponse} from './worker/src/api/notifications';export default {async fetch(request){return await notificationsResponse(request,{SUPABASE_URL:'https://db.example.test',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-only-not-real'})??new Response('Not found',{status:404});}}`,
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
          name: 'alerts-runtime',
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
            handler: async (request) => {
              const url = new URL(request.url);
              if (url.pathname === '/auth/v1/user')
                return Response.json({ id: owner });
              if (url.pathname === '/rest/v1/rpc/create_test_alert') {
                writes.push(await request.json());
                return Response.json('notification-fixture');
              }
              throw Error('Unexpected fixture destination');
            },
          },
        },
      },
    ],
  });
  try {
    expect(
      (
        await mf.dispatchFetch('http://worker.test/v1/notifications/test', {
          method: 'POST',
        })
      ).status,
    ).toBe(401);
    const result = await mf.dispatchFetch(
      'http://worker.test/v1/notifications/test',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fixture.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          watchlistId: list,
          stockId: stock,
          owner_id: 'forged-owner',
        }),
      },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      id: 'notification-fixture',
      emailConfigured: false,
    });
    expect(writes).toEqual([{ owner, list, stock, send_email: false }]);
    expect(
      (
        await mf.dispatchFetch('http://worker.test/v1/notifications/test', {
          method: 'POST',
          headers: { Authorization: 'Bearer fixture.jwt.token' },
          body: 'x'.repeat(2001),
        })
      ).status,
    ).toBe(413);
  } finally {
    await mf.dispose();
  }
});
