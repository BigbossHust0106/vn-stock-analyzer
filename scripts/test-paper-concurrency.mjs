import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
// Only called against the disposable, network-isolated verifier database.
export async function testPaperConcurrency(name) {
  const run = (sql) =>
    new Promise((resolve, reject) => {
      const child = spawn('docker', [
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
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, out: out.trim(), err }));
      child.stdin.end(sql);
    });
  const owner = '92000000-0000-0000-0000-000000000001',
    stock = '92000000-0000-0000-0000-000000000002';
  let r = await run(
    `insert into auth.users(id) values('${owner}'); insert into public.stocks(id,symbol,name,exchange,source,search_text) values('${stock}','ZP2','Race fixture','HOSE','fixture','zp2'); set role service_role; select public.paper_create_wallet('${owner}','Race',10000000,0,0,gen_random_uuid())->>'id';`,
  );
  assert.equal(r.code, 0, r.err);
  const wallet = r.out.split('\n').at(-1);
  const quote = async (price) => {
    const q = await run(
      `set role service_role; select public.paper_create_quote('${owner}','${stock}',${price},clock_timestamp(),'source')->>'id';`,
    );
    assert.equal(q.code, 0, q.err);
    return q.out.split('\n').at(-1);
  };
  const order = (q, side) =>
    run(
      `set role service_role; select public.paper_execute_order('${owner}','${wallet}','${q}','${side}',100,gen_random_uuid())->>'id';`,
    );
  const buys = await Promise.all(
    [await quote(60000), await quote(60000)].map((q) => order(q, 'buy')),
  );
  assert.equal(buys.filter((x) => x.code === 0).length, 1);
  assert(buys.some((x) => x.err.includes('PAPER_INSUFFICIENT_CASH')));
  const sells = await Promise.all(
    [await quote(61000), await quote(61000)].map((q) => order(q, 'sell')),
  );
  assert.equal(sells.filter((x) => x.code === 0).length, 1);
  assert(sells.some((x) => x.err.includes('PAPER_INSUFFICIENT_SHARES')));
  // Hand: 10m - 100*60,000 + 100*61,000 =10.1m, zero shares, two fills.
  r = await run(
    `select cash_vnd||','||realized_vnd||','||(select quantity from public.paper_positions where wallet_id='${wallet}')||','||(select count(*) from public.paper_trades where wallet_id='${wallet}') from public.paper_wallets where id='${wallet}';`,
  );
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '10100000,100000,0,2');
  console.log(
    'PAPER CONCURRENCY PASS: simultaneous buys cannot overdraw; simultaneous sells cannot short; exact cash and two fills',
  );
}
