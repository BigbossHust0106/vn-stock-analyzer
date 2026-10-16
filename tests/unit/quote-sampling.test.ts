import { afterEach, expect, it, vi } from 'vitest';
import { sampleQuotes } from '../../worker/src/quote-sampling';
import fixture from '../../fixtures/vps-getliststockdata-sample.json';
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
  SYNC_SYMBOLS: 'ACB',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([
  '2026-10-17T03:00:00Z',
  '2026-10-16T00:30:00Z',
  '2026-10-16T05:00:00Z',
  '2026-10-16T08:01:00Z',
])(
  'snapshot sampler %s stops weekends, lunch and outside configured observation hours',
  async (stamp) => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    expect((await sampleQuotes(env, Date.parse(stamp))).state).toBe('skipped');
    expect(transport).not.toHaveBeenCalled();
  },
);
it('confirmed holiday never calls source, missing calendar still samples display-only quotes and reports degraded', async () => {
  let closed = true;
  const calls: string[] = [],
    writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const u = String(input);
      calls.push(u);
      if (init?.body)
        writes.push({ url: u, body: JSON.parse(String(init.body)) });
      if (u.includes('/trading_sessions'))
        return Response.json(closed ? { is_open: false } : null);
      if (u.includes('/stocks?')) return Response.json([{ symbol: 'ACB' }]);
      if (u.includes('bgapidatafeed')) return Response.json([fixture[0]]);
      if (u.includes('/rpc/ingest_current_quotes')) return Response.json(null);
      if (u.includes('/system_status'))
        return new Response(null, { status: 201 });
      throw Error('Unexpected request');
    }),
  );
  const stamp = Date.parse('2026-10-16T03:00:00Z');
  expect(await sampleQuotes(env, stamp)).toEqual({
    state: 'skipped',
    code: 'SESSION_CLOSED',
  });
  expect(calls).toHaveLength(1);
  closed = false;
  expect(await sampleQuotes(env, stamp)).toEqual({
    state: 'degraded',
    code: 'CALENDAR_MISSING',
  });
  expect(
    writes.find((w) => w.url.includes('ingest_current_quotes'))!.body,
  ).toMatchObject({
    rows: [{ last_price_vnd: 20450, total_volume_shares: 7969100 }],
  });
  expect(
    calls.some((u) =>
      /prices_daily|ingest_price_history|publish_rankings/.test(u),
    ),
  ).toBe(false);
  expect(
    writes.find((w) => w.url.includes('system_status'))!.body,
  ).toMatchObject({ state: 'degraded' });
});
it('registered one-minute cron actually samples and logs degraded calendar state, without creating a calendar', async () => {
  const rankingSync = vi
    .spyOn(await import('../../worker/src/ranking-sync'), 'syncRankings')
    .mockResolvedValue();
  const { default: worker } = await import('../../worker/src/index');
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const u = String(input);
      if (init?.body)
        writes.push({ url: u, body: JSON.parse(String(init.body)) });
      if (u.includes('claim_system_job'))
        return Response.json([{ id: 'job', generation: 1 }]);
      if (u.includes('/trading_sessions')) return Response.json(null);
      if (u.includes('/stocks?')) return Response.json([{ symbol: 'ACB' }]);
      if (u.includes('bgapidatafeed')) return Response.json([fixture[0]]);
      if (u.includes('ingest_current_quotes')) return Response.json(null);
      if (u.includes('/system_status'))
        return new Response(null, { status: 201 });
      if (u.includes('system_job_runs'))
        return new Response(null, { status: 204 });
      throw Error('Unexpected request');
    }),
  );
  const jobs: Promise<unknown>[] = [];
  worker.scheduled(
    {
      cron: '* 2-8 * * 1-5',
      scheduledTime: Date.parse('2026-10-16T03:00:00Z'),
    } as ScheduledController,
    env,
    {
      waitUntil: (p) => {
        jobs.push(p);
      },
    },
  );
  await Promise.all(jobs);
  expect(jobs).toHaveLength(1);
  expect(rankingSync).toHaveBeenCalledOnce();
  expect(
    writes.find((w) => w.url.includes('claim_system_job'))!.body,
  ).toMatchObject({ task: 'prices' });
  expect(
    writes.find((w) => w.url.includes('system_job_runs'))!.body,
  ).toMatchObject({ state: 'degraded', code: 'CALENDAR_MISSING' });
  expect(writes.some((w) => w.url.includes('/trading_sessions'))).toBe(false);
});
