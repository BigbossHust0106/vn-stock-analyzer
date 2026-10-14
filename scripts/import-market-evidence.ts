import { readFile } from 'node:fs/promises';
import { parseEvidence } from '../modules/market/evidence';
import { databaseQuery, sqlJson } from './management';
async function main() {
  const file = process.argv[2];
  if (!file || !file.endsWith('.json'))
    throw new Error(
      'Dùng npm run import:evidence -- /path/calendar-events.json; chỉ nhập dữ liệu đã xác minh nguồn',
    );
  const evidence = parseEvidence(JSON.parse(await readFile(file, 'utf8')));
  await databaseQuery(`begin;
 select 1/(case count(*) when 0 then 1 else 0 end) from jsonb_to_recordset(${sqlJson(evidence.events)}) as r(symbol text) where not exists(select 1 from public.stocks s where s.symbol=r.symbol and s.active);
 insert into public.trading_sessions(session_date,is_open,closes_at,source,verified_at)
 select r.session_date,r.is_open,r.closes_at,r.source,r.verified_at from jsonb_to_recordset(${sqlJson(evidence.sessions)})as r(session_date date,is_open boolean,closes_at timestamptz,source text,verified_at timestamptz)
 on conflict(session_date)do update set is_open=excluded.is_open,closes_at=excluded.closes_at,source=excluded.source,verified_at=excluded.verified_at where excluded.verified_at>public.trading_sessions.verified_at;
 insert into public.corporate_events(stock_id,kind,event_date,title,source_url,known_at)
 select s.id,r.kind,r.event_date,r.title,r.source_url,r.known_at from jsonb_to_recordset(${sqlJson(evidence.events)})as r(symbol text,kind text,event_date date,title text,source_url text,known_at timestamptz) join public.stocks s on s.symbol=r.symbol and s.active
 on conflict(stock_id,kind,event_date,source_url)do update set title=excluded.title,known_at=excluded.known_at;
 commit;`);
  console.log(
    `EVIDENCE IMPORT PASS: ${evidence.sessions.length} phiên, ${evidence.events.length} sự kiện có nguồn (nguồn do người nhập xác minh)`,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Nhập bằng chứng thất bại');
  process.exitCode = 1;
});
