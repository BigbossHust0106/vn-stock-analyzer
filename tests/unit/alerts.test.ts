import { it, expect, vi, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  evaluateAlert,
  type AlertRule,
  type AlertInputs,
} from '../../modules/alerts/evaluate';
import { runJob } from '../../worker/src/jobs/runner';
import { deliverAlertEmails } from '../../worker/src/alerts/email';
import { notificationsResponse } from '../../worker/src/api/notifications';
import worker from '../../worker/src/index';
const now = '2026-10-15T03:00:00Z';
const rule: AlertRule = {
  id: '71000000-0000-0000-0000-000000000005',
  owner_id: '71000000-0000-0000-0000-000000000001',
  watchlist_id: '71000000-0000-0000-0000-000000000004',
  stock_id: '71000000-0000-0000-0000-000000000003',
  kind: 'buy_zone',
  enabled: true,
  email_enabled: false,
  lower_vnd: 10000,
  upper_vnd: 11000,
  score_delta: 10,
  horizon: 'quarter',
  config_version: 1,
  created_at: '2026-10-15T00:00:00Z',
};
const input: AlertInputs = {
  symbol: 'DPR',
  price: { value: 10500, asOf: now },
  score: null,
  news: [],
  asOf: now,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('vùng mua: chỉ báo một lần khi ở trong vùng, tái kích hoạt sau khi ra ngoài; bỏ snapshot cũ/tương lai/tham chiếu', () => {
  const first = evaluateAlert(rule, {}, input);
  expect(first.events).toHaveLength(1);
  expect(first.events[0]?.evidence.priceVnd).toBe(10500);
  expect(evaluateAlert(rule, first.state, input).events).toEqual([]);
  const inZone = evaluateAlert(rule, first.state, {
    ...input,
    asOf: '2026-10-15T03:02:00Z',
    price: { value: 10600, asOf: '2026-10-15T03:01:00Z' },
  });
  expect(inZone.events).toEqual([]);
  const out = evaluateAlert(rule, inZone.state, {
    ...input,
    asOf: '2026-10-15T03:03:00Z',
    price: { value: 12000, asOf: '2026-10-15T03:03:00Z' },
  });
  expect(out.events).toEqual([]);
  expect(
    evaluateAlert(rule, out.state, {
      ...input,
      asOf: '2026-10-15T03:04:00Z',
      price: { value: 11000, asOf: '2026-10-15T03:04:00Z' },
    }).events,
  ).toHaveLength(1);
  for (const price of [
    null,
    { value: null, asOf: now },
    { value: 10500, asOf: '2026-10-14T03:00:00Z' },
    { value: 10500, asOf: '2026-10-15T03:01:00Z' },
    { value: NaN, asOf: now },
  ])
    expect(evaluateAlert(rule, {}, { ...input, price }).events).toEqual([]);
  expect(evaluateAlert({ ...rule, enabled: false }, {}, input).events).toEqual(
    [],
  );
});
it('nhảy qua vùng dùng hai snapshot, không bịa khớp lệnh; TP/stop nhận đúng chiều VND', () => {
  const crossed = evaluateAlert(
    rule,
    { config: 1, price: 9000, priceAt: '2026-10-15T02:59:00Z', active: false },
    { ...input, price: { value: 12000, asOf: now } },
  );
  expect(crossed.events[0]?.body).toContain('không xác nhận');
  expect(
    evaluateAlert({ ...rule, kind: 'sell_zone', upper_vnd: null }, {}, input)
      .events,
  ).toHaveLength(1);
  expect(
    evaluateAlert(
      { ...rule, kind: 'stop_loss', upper_vnd: null, lower_vnd: 11000 },
      {},
      input,
    ).events,
  ).toHaveLength(1);
  expect(evaluateAlert({ ...rule, lower_vnd: null }, {}, input).events).toEqual(
    [],
  );
  expect(evaluateAlert(rule, {}, { ...input, asOf: 'bad' }).events).toEqual([]);
});
it('điểm: lưu baseline, thay đổi đúng 10 điểm kích hoạt; thiếu dữ liệu không biến thành 0', () => {
  const r = {
    ...rule,
    kind: 'score_change' as const,
    lower_vnd: null,
    upper_vnd: null,
  };
  const initial = evaluateAlert(
    r,
    {},
    { ...input, score: { value: 60, asOf: now, complete: true } },
  );
  expect(initial.events).toEqual([]);
  const next = {
    ...input,
    asOf: '2026-10-15T03:05:00Z',
    score: { value: 70, asOf: '2026-10-15T03:05:00Z', complete: true },
  };
  expect(evaluateAlert(r, initial.state, next).events).toHaveLength(1);
  expect(
    evaluateAlert(r, initial.state, {
      ...next,
      score: { ...next.score, complete: false },
    }).events,
  ).toEqual([]);
  expect(
    evaluateAlert(r, initial.state, {
      ...next,
      score: { ...next.score, value: null },
    }).events,
  ).toEqual([]);
  expect(
    evaluateAlert({ ...r, config_version: 2 }, initial.state, next).events,
  ).toEqual([]);
});
it('tin quan trọng: chỉ bằng chứng LLM hợp lệ, đúng mã, sau ngày bật; không lặp cùng bài', () => {
  const a = {
    id: 'a'.repeat(64),
    source_id: 'cafef',
    source_url: 'https://cafef.vn/fixture',
    title: 'DPR thông báo cổ tức bằng tiền',
    excerpt: 'Dữ liệu RSS dùng trong unit test.',
    fingerprint: 'b'.repeat(64),
    published_at: '2026-10-15T02:00:00Z',
    fetched_at: now,
    symbols: ['DPR'],
    sectors: [],
    factors: ['corporate'],
    macro_topics: [],
    analysis_status: 'ok' as const,
    analysis: {
      summary: 'DPR thông báo cổ tức bằng tiền',
      evidence: 'DPR thông báo cổ tức bằng tiền',
      sentiment: 'positive' as const,
      impact: 'high' as const,
      horizon: 'short' as const,
    },
    model: 'fixture',
    analyzed_at: now,
  };
  const r = {
    ...rule,
    kind: 'important_news' as const,
    lower_vnd: null,
    upper_vnd: null,
  };
  const result = evaluateAlert(r, {}, { ...input, news: [a] });
  expect(result.events[0]?.source_url).toBe(a.source_url);
  expect(
    evaluateAlert(r, result.state, { ...input, news: [a] }).events,
  ).toEqual([]);
  expect(
    evaluateAlert(r, {}, { ...input, news: [{ ...a, symbols: ['VNM'] }] })
      .events,
  ).toEqual([]);
  expect(
    evaluateAlert(
      r,
      {},
      {
        ...input,
        news: [
          { ...a, analysis: { ...a.analysis, summary: 'Bịa tăng 999 tỷ' } },
        ],
      },
    ).events,
  ).toEqual([]);
  expect(
    evaluateAlert({ ...r, created_at: now }, {}, { ...input, news: [a] })
      .events,
  ).toEqual([]);
});
it('runner retry có giới hạn, lưu lỗi an toàn, không log credential; không chạy lại job đã claim', async () => {
  const writes: unknown[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const db = createClient('https://db.example.test', 'fixture', {
    global: {
      fetch: async (input, init) => {
        if (String(input).includes('/rpc/claim_system_job'))
          return Response.json([{ id: 'test-run', generation: 1 }]);
        writes.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      },
    },
  });
  let n = 0;
  const work = vi.fn(async () => {
    if (n++ === 0) throw Error('secret-data must not be logged');
    return { state: 'ok' as const };
  });
  expect(
    await runJob(db, 'alerts', Date.parse(now), work, async () => {}),
  ).toEqual({ state: 'ok' });
  expect(work).toHaveBeenCalledTimes(2);
  expect(writes).toMatchObject([
    { state: 'running', attempts: 1, code: 'JOB_FAILED' },
    { state: 'ok', attempts: 2 },
  ]);
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret-data');
  log.mockRestore();
  const empty = createClient('https://db.example.test', 'fixture', {
    global: { fetch: async () => Response.json([]) },
  });
  expect(await runJob(empty, 'alerts', Date.parse(now), work)).toEqual({
    state: 'skipped',
  });
});
it('email: thiếu cấu hình không gọi nhà cung cấp; có opt-in và email đã xác minh mới gửi, idempotency ổn định', async () => {
  let optIn = true,
    confirmed = true,
    enabled = true;
  const sends: RequestInit[] = [];
  const writes: Record<string, unknown>[] = [];
  const db = createClient('https://db.example.test', 'fixture', {
    global: {
      fetch: async (input, init) => {
        const u = String(input);
        if (u.includes('/rpc/claim_alert_emails'))
          return Response.json([
            { notification_id: 'fixture-id', attempts: 1 },
          ]);
        if (u.includes('/notifications'))
          return Response.json({
            id: 'fixture-id',
            owner_id: rule.owner_id,
            rule_id: rule.id,
            kind: 'buy_zone',
            title: 'Fixture',
            body: 'Fixture only',
            source_url: null,
            created_at: now,
            stocks: { symbol: 'DPR' },
          });
        if (u.includes('/user_settings'))
          return Response.json({ email_alerts: optIn });
        if (u.includes('/watchlist_alert_rules'))
          return Response.json({ enabled, email_enabled: true });
        if (u.includes('/auth/v1/admin/users/'))
          return Response.json({
            id: rule.owner_id,
            email: 'confirmed@example.test',
            email_confirmed_at: confirmed ? now : null,
          });
        if (u.includes('/alert_email_outbox')) {
          writes.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 204 });
        }
        throw Error('Unexpected fixture request');
      },
    },
  });
  expect(await deliverAlertEmails(db, {}, Date.parse(now))).toMatchObject({
    configured: false,
  });
  const env = {
    ALERT_EMAIL_API_KEY: 'local-fixture',
    ALERT_EMAIL_FROM: 'alerts@example.test',
  };
  expect(
    await deliverAlertEmails(db, env, Date.parse(now), async (_input, init) => {
      sends.push(init!);
      return Response.json({ id: 'provider-fixture' });
    }),
  ).toMatchObject({ sent: 1 });
  expect(new Headers(sends[0]?.headers).get('Idempotency-Key')).toBe(
    'watchlist-alert/fixture-id',
  );
  expect(writes[0]).toMatchObject({
    state: 'sent',
    provider_id: 'provider-fixture',
  });
  expect(
    await deliverAlertEmails(
      db,
      env,
      Date.parse(now),
      async () => new Response('', { status: 503 }),
    ),
  ).toMatchObject({ sent: 0 });
  expect(writes.at(-1)).toMatchObject({
    state: 'pending',
    code: 'EMAIL_RETRY',
  });
  const denied = vi.fn<typeof fetch>(async () => {
    throw Error('Must not send');
  });
  optIn = false;
  await deliverAlertEmails(db, env, Date.parse(now), denied);
  expect(writes.at(-1)).toMatchObject({
    state: 'cancelled',
    code: 'EMAIL_OPTED_OUT',
  });
  optIn = true;
  confirmed = false;
  await deliverAlertEmails(db, env, Date.parse(now), denied);
  expect(writes.at(-1)).toMatchObject({
    state: 'cancelled',
    code: 'EMAIL_NOT_CONFIRMED',
  });
  confirmed = true;
  enabled = false;
  await deliverAlertEmails(db, env, Date.parse(now), denied);
  expect(writes.at(-1)).toMatchObject({
    state: 'cancelled',
    code: 'EMAIL_OPTED_OUT',
  });
  expect(denied).not.toHaveBeenCalled();
});
it('API cảnh báo: không đăng nhập bị chặn, user ID lấy từ JWT đã xác thực; endpoint nội bộ không nhận publishable key', async () => {
  expect(
    (
      await notificationsResponse(
        new Request('https://worker.test/v1/notifications/test', {
          method: 'POST',
        }),
        {},
      )
    )?.status,
  ).toBe(401);
  expect(
    (
      await worker.fetch(
        new Request('https://worker.test/v1/internal/system-sync', {
          method: 'POST',
        }),
      )
    )?.status,
  ).toBe(401);
});
