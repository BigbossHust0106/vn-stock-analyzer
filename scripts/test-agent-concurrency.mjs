import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
export async function testAgentConcurrency(name) {
  const run = (sql) =>
    new Promise((resolve, reject) => {
      const p = spawn('docker', [
        'exec',
        '-i',
        name,
        'psql',
        '-X',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ]);
      let out = '',
        err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.once('error', reject);
      p.once('close', (code) => resolve({ code, out: out.trim(), err }));
      p.stdin.end(sql);
    });
  const uid = '98000000-0000-0000-0000-000000000001',
    sid = '98000000-0000-0000-0000-000000000002',
    lid = '98000000-0000-0000-0000-000000000003',
    rid = '98000000-0000-0000-0000-000000000004';
  const auth = `set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);`;
  const initial = await run(
    `insert into auth.users(id)values('${uid}');insert into public.stocks(id,symbol,name,exchange,source,search_text)values('${sid}','ZAC','Agent race fixture','HOSE','fixture','zac');${auth}insert into public.watchlists(id,name)values('${lid}','Agent race');insert into public.watchlist_items(watchlist_id,stock_id)values('${lid}','${sid}');insert into public.watchlist_alert_rules(id,watchlist_id,stock_id,kind,lower_vnd)values('${rid}','${lid}','${sid}','stop_loss',10000);select public.prepare_agent_action('{"type":"toggle_alert","listId":"${lid}","stockId":"${sid}","alertId":"${rid}","enabled":false}','Tắt cảnh báo')->>'id';`,
  );
  assert.equal(initial.code, 0, initial.err);
  const id = initial.out.split('\n').at(-1);
  const results = await Promise.all([
    run(`${auth}select public.resolve_agent_action('${id}',true);`),
    run(`${auth}select public.resolve_agent_action('${id}',true);`),
  ]);
  for (const r of results) {
    assert.equal(r.code, 0, r.err);
    assert(r.out.includes('applied'));
  }
  const result = await run(
    `select enabled::text||','||config_version from public.watchlist_alert_rules where id='${rid}';`,
  );
  assert.equal(result.code, 0, result.err);
  // One actual toggle increments version1 ->2. A duplicate execution would increment it to3.
  assert.equal(result.out, 'false,2');
  console.log(
    'AGENT CONCURRENCY PASS: two simultaneous confirmations apply once; alert version2, not3.',
  );
}
