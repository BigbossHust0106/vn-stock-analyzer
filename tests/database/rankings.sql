\set ON_ERROR_STOP on
begin;
insert into public.stocks(symbol,name,exchange,sector,sector_source_url)
select 'T'||lpad(n::text,2,'0'),'Synthetic ranking test',case when n=1 then 'HNX'::public.exchange_code else 'HOSE'::public.exchange_code end,case when n=1 then 'Test small sector' else 'Test other' end,'https://source.example/test' from generate_series(1,12)n;
set local role service_role;
select public.publish_rankings('2020-01-02','2020-01-02T09:00:00Z',(
 select jsonb_agg(jsonb_build_object('stock_id',s.id,'horizon',h,'value',substring(s.symbol from 2)::integer,'inputs_as_of','2020-01-02T08:00:00Z','explanation',jsonb_build_object('marketCapVnd',substring(s.symbol from 2)::integer*1e11),'financial_version','40000000-0000-4000-8000-000000000001','quote_version','40000000-0000-4000-8000-000000000002','financial_inputs',jsonb_build_object('epsAnnualVnd',4),'quote_inputs',jsonb_build_object('lastPriceVnd',20)))
 from public.stocks s cross join unnest(array['day','month','quarter'])h where s.symbol ~ '^T[0-9]{2}$'
));
do $$ begin
 if (select count(*) from public.rankings)<>36 then raise exception 'Not all horizons published';end if;
 if exists(select 1 from public.scores where model_version='top10-v1' and (financial_version is distinct from '40000000-0000-4000-8000-000000000001'::uuid or quote_version is distinct from '40000000-0000-4000-8000-000000000002'::uuid or financial_inputs->>'epsAnnualVnd' is distinct from '4' or quote_inputs->>'lastPriceVnd' is distinct from '20')) then raise exception 'Ranking inputs lost';end if;
 begin perform public.publish_rankings('2020-01-02','2020-01-02T09:01:00Z','[{"stock_id":"20000000-0000-4000-8000-000000000001","horizon":"day"}]');raise exception 'Incomplete batch published';exception when raise_exception then if sqlerrm<>'Incomplete ranking horizons' then raise;end if;end;
 if (select count(*) from public.rankings)<>36 then raise exception 'Partial publication';end if;
end $$;
select public.publish_rankings('2020-01-02','2020-01-02T08:00:00Z',(
 select jsonb_agg(jsonb_build_object('stock_id',s.id,'horizon',h,'value',99,'inputs_as_of','2020-01-02T07:00:00Z','explanation',jsonb_build_object('marketCapVnd',1e11))) from public.stocks s cross join unnest(array['day','month','quarter'])h where s.symbol ~ '^T[0-9]{2}$'
));
set local role anon;
do $$ begin
 if(select count(*) from public.top_rankings('day'))<>10 then raise exception 'Not top10';end if;
 if(select max(score) from public.top_rankings('day'))<>12 then raise exception 'Stale batch replaced scores';end if;
 if(select symbol from public.top_rankings('month','HNX'))<>'T01' then raise exception 'Exchange filter after limit';end if;
 if(select symbol from public.top_rankings('quarter',null,'Test small sector'))<>'T01' then raise exception 'Sector filter after limit';end if;
 if(select count(*) from public.top_rankings('day',null,null,1e11,3e11))<>2 then raise exception 'Cap boundaries';end if;
 begin perform public.publish_rankings('2020-01-02','2020-01-02T09:00:00Z','[]');raise exception 'Anon publishes';exception when insufficient_privilege then null;end;
 begin perform public.watchlist_snapshot(gen_random_uuid());raise exception 'Anon watchlist snapshot';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.scores(stock_id,as_of,horizon,model_version,value,inputs_as_of) select id,'2020-01-01','quarter','top10-v1',7,'2020-01-01T09:00:00Z' from public.stocks where symbol='T01';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
insert into public.watchlists(id,name) values('30000000-0000-4000-8000-000000000002','B');
insert into public.watchlist_items(watchlist_id,stock_id,notes,target_price_vnd) select '30000000-0000-4000-8000-000000000002',id,'B private note',10000 from public.stocks where symbol='T01';
do $$ begin
 if (select notes from public.watchlist_snapshot('30000000-0000-4000-8000-000000000002'))<>'B private note' or (select previous_score from public.watchlist_snapshot('30000000-0000-4000-8000-000000000002'))<>7 or (select score from public.watchlist_snapshot('30000000-0000-4000-8000-000000000002'))<>1 then raise exception 'Own snapshot/current/previous score failed';end if;
 begin update public.watchlist_items set target_price_vnd=0;raise exception 'Zero target accepted';exception when check_violation then null;end;
 begin update public.watchlist_items set target_price_vnd='NaN';raise exception 'NaN target accepted';exception when check_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare n integer;begin
 if exists(select 1 from public.watchlist_snapshot('30000000-0000-4000-8000-000000000002')) then raise exception 'A sees B snapshot';end if;
 update public.watchlist_items set notes='forged',target_price_vnd=1;get diagnostics n=row_count;if n<>0 then raise exception 'A edits B notes/target';end if;
end $$;
reset role;
rollback;
\echo PHASE4 DB PASS: atomic three horizons, stale protection, filters before top10, score history, notes/target RLS, anonymous denied
