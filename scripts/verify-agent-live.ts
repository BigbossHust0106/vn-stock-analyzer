import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { managementClient } from './sync-rankings';
import type { AgentReply } from '../modules/agent/plan';
const base =
  process.env.MARKET_APP_URL ||
  'https://vn-stock-analyzer.manhhuong.workers.dev';
const { db: admin } = await managementClient();
const config = (await (await fetch(base + '/v1/public-config')).json()) as {
  supabaseUrl: string;
  supabasePublishableKey: string;
};
const ids: string[] = [];
function assert(v: unknown, message: string): asserts v {
  if (!v) throw Error(message);
}
async function user() {
  const email = `codex-agent-${randomUUID()}@example.test`,
    password = randomBytes(32).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert(!error && data.user, 'Cannot create agent test user');
  ids.push(data.user.id);
  const db = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await db.auth.signInWithPassword({ email, password });
  assert(session.data.session, 'Cannot login agent test user');
  const token = session.data.session.access_token;
  const call = async (body: unknown, expected = 200) => {
    const r = await fetch(base + '/v1/agent', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
    });
    const value = (await r.json()) as AgentReply & {
      error?: string;
      code?: string;
      stage?: string;
      providerCode?: string;
      resolution?: { status: string };
    };
    console.log(
      'AGENT LIVE HTTP:',
      r.status,
      value.code ?? 'OK',
      value.stage ?? '',
      value.providerCode ?? '',
    );
    assert(
      r.status === expected,
      'Agent response: ' + (value.error ?? 'unexpected HTTP'),
    );
    return value;
  };
  return { db, call };
}
try {
  const a = await user();
  const research = await a.call({ op: 'chat', messages: ['Phân tích FPT'] });
  assert(
    research.text.includes('FPT') &&
      research.text.includes('Graham') &&
      research.text.includes('không đủ dữ liệu') &&
      research.sources.some((s) => s.url === '/stocks?symbol=FPT'),
    'Grounded FPT response missing',
  );
  console.log(
    'AI LIVE RESEARCH PASS: actual Cloudflare inference, FPT engine facts with source; unknown data retained.',
  );
  const compare = await a.call({
    op: 'chat',
    messages: ['So sánh VNM và HPG'],
  });
  assert(
    compare.sources.some((s) => s.url === '/stocks?symbol=VNM') &&
      compare.sources.some((s) => s.url === '/stocks?symbol=HPG'),
    'Model comparison routing wrong',
  );
  console.log('AI LIVE COMPARE PASS: VNM/HPG actual source data.');
  const nameA = 'AI live A ' + Date.now();
  const p = await a.call({ op: 'chat', messages: ['Tạo danh sách ' + nameA] });
  assert(p.proposal, 'Missing preview');
  assert(
    (await a.db.from('watchlists').select('id').eq('name', nameA)).data
      ?.length === 0,
    'Preview mutated lists',
  );
  const b = await user();
  await b.call({ op: 'confirm', id: p.proposal.id }, 404);
  const applied = await a.call({ op: 'confirm', id: p.proposal.id });
  assert(applied.resolution?.status === 'applied', 'Confirm A failed');
  await a.call({ op: 'confirm', id: p.proposal.id });
  assert(
    (await a.db.from('watchlists').select('id').eq('name', nameA)).data
      ?.length === 1,
    'Duplicate apply',
  );
  assert(
    (await b.db.from('watchlists').select('id').eq('name', nameA)).data
      ?.length === 0,
    'B reads A list',
  );
  const nameB = 'AI live B ' + Date.now();
  const list = await b.call({
    op: 'chat',
    messages: ['Tạo danh sách ' + nameB],
  });
  assert(list.proposal, 'Missing B list preview');
  await b.call({ op: 'confirm', id: list.proposal.id });
  const added = await b.call({
    op: 'chat',
    messages: ['Thêm FPT vào danh sách ' + nameB],
  });
  assert(
    added.proposal && added.proposal.summary.includes('FPT'),
    'Missing FPT preview',
  );
  await b.call({ op: 'confirm', id: added.proposal.id });
  const alert = await b.call({
    op: 'chat',
    messages: [
      'Tạo cảnh báo cắt lỗ FPT trong danh sách ' + nameB + ' ở mức 55.000 VND',
    ],
  });
  assert(
    alert.proposal &&
      alert.proposal.summary.includes('55.000 VND') &&
      alert.proposal.summary.includes('cắt lỗ'),
    'Alert price/type misinterpreted',
  );
  await b.call({ op: 'cancel', id: alert.proposal.id });
  assert(
    (await b.db.from('watchlist_alert_rules').select('id')).data?.length === 0,
    'Cancelled alert created',
  );
  console.log(
    'AI LIVE ACTIONS PASS: real model create-list/add-FPT/55000-VND stop-loss preview; explicit confirm/cancel; idempotency and two-user isolation. No trade or email sent.',
  );
} finally {
  let failed = false;
  for (const id of ids) {
    const r = await admin.auth.admin.deleteUser(id);
    if (r.error) failed = true;
  }
  if (failed) {
    process.exitCode = 1;
    console.error('AI LIVE CLEANUP FAIL: test users could not all be removed.');
  } else
    console.log(
      'AI LIVE CLEANUP PASS: temporary users and private test data removed.',
    );
}
