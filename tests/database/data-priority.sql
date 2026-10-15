\set ON_ERROR_STOP on
begin;
-- Independent example: one stock has Graham .8 / Buffett .6 => mean .7;
-- the alphabetically earlier stock has .2 / .4 => .3. Higher availability comes first.
insert into public.stocks(id,symbol,exchange,name,search_text) values
('30000000-0000-4000-8000-000000000001','ZA1','HOSE','Synthetic complete','za1 synthetic complete'),
('30000000-0000-4000-8000-000000000002','AA1','HOSE','Synthetic partial','aa1 synthetic partial');
insert into public.financial_snapshots(stock_id,source,fetched_at,payload) values
('30000000-0000-4000-8000-000000000001','KBS_VIETCAP',now(),'{"annual":[{"year":2025}]}'),
('30000000-0000-4000-8000-000000000002','KBS_VIETCAP',now(),'{"annual":[{"year":2025}]}');
insert into public.scores(stock_id,as_of,horizon,model_version,value,inputs_as_of,financial_version,explanation)
select f.stock_id,current_date,'month','synthetic',20,now(),f.version,
case when f.stock_id='30000000-0000-4000-8000-000000000001' then '{"strategies":[{"coverage":0.8},{"coverage":0.6}]}'::jsonb
else '{"strategies":[{"coverage":0.2},{"coverage":0.4}]}'::jsonb end
from public.financial_snapshots f where stock_id in('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
set local role anon;
do $$declare x record; begin
 select * into x from public.search_stocks_by_coverage('synthetic',null) limit 1;
 if x.symbol is distinct from 'ZA1' or abs(x.coverage-.7)>.00001 or x.graham_coverage is distinct from .8::float8 or x.buffett_coverage is distinct from .6::float8 then raise exception 'Priority does not reflect both strategy coverage';end if;
 select * into x from public.search_stocks_by_coverage('aa1',null) limit 1;
 if x.symbol is distinct from 'AA1' then raise exception 'Exact query must remain searchable';end if;
 if exists(select 1 from public.search_stocks_by_coverage('synthetic','HNX')) then raise exception 'Exchange filter ignored';end if;
 if exists(select 1 from public.search_stocks_by_coverage('%',null)) then raise exception 'Wildcard not escaped';end if;
end $$;
reset role;
rollback;
\echo DATA PRIORITY PASS: both strategies, 0.7 vs 0.3, exact query, exchange, escaping, public RLS read
