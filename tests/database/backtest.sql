\set ON_ERROR_STOP on
begin;
insert into public.stocks(id,symbol,name,exchange,active,source,search_text) values('81000000-0000-0000-0000-000000000003','ZB8','Backtest SQL fixture','HOSE',true,'fixture','zb8');
insert into public.scores(id,stock_id,as_of,horizon,model_version,value,inputs_as_of,computed_at,explanation) values('81000000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000003','2025-01-09','day','top10-v1',80,'2025-01-09','2025-01-09','{"coverage":1,"rankingEligibility":{"policy":"complete-v1","eligible":true,"quoteVerified":true,"financialCoverage":1,"blockers":[]}}');
insert into public.rankings(as_of,horizon,model_version,stock_id,score_id,position) values('2025-01-09','day','top10-v1','81000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000004',1);
insert into public.ranking_runs(as_of,model_version,computed_at,universe_count) values('2025-01-09','top10-v1','2025-01-09',1);
do $$ declare frozen jsonb; observed timestamptz; begin
 select items,recorded_at into frozen,observed from public.ranking_publications where as_of='2025-01-09' and horizon='day';
 if frozen#>>'{0,score}'<>'80.000' and (frozen#>>'{0,score}')::numeric<>80 then raise exception 'Wrong snapshot';end if;
 if observed<'2026-01-01' then raise exception 'Historical publication was fabricated';end if;
 update public.scores set value=20 where id='81000000-0000-0000-0000-000000000004';
 if (select items from public.ranking_publications where as_of='2025-01-09' and horizon='day')<>frozen then raise exception 'Snapshot changed with mutable scores';end if;
 begin update public.ranking_publications set items='[]' where as_of='2025-01-09';raise exception 'Immutable guard missing';exception when raise_exception then if sqlerrm<>'Publication is immutable' then raise;end if;end;
 if (select count(*) from public.ranking_publications where as_of='2025-01-09')<>3 then raise exception 'Missing empty horizons';end if;
 if jsonb_array_length(public.backtest_history('day',null,null,1))<>1 then raise exception 'Pagination failed';end if;
 begin perform public.backtest_history('day',null,null,11);raise exception 'Unbounded page';exception when raise_exception then if sqlerrm<>'Invalid pagination' then raise;end if;end;
 begin perform public.backtest_history('day',null,null,null);raise exception 'Null page unbounded';exception when raise_exception then if sqlerrm<>'Invalid pagination' then raise;end if;end;
end $$;
insert into public.trading_sessions(session_date,is_open,closes_at,source,verified_at)
select d,true,d::timestamptz+interval '8 hours','fixture calendar',now() from unnest(array['2025-01-10'::date,'2025-02-10'::date,'2025-04-10'::date,'2025-01-13'::date,'2025-01-31'::date,'2025-02-28'::date])d;
insert into public.prices_daily(stock_id,session_date,price_basis,open_vnd,high_vnd,low_vnd,close_vnd,volume_shares,source)
select '81000000-0000-0000-0000-000000000003',d,'unadjusted',30000,40000,20000,c,10000,'fixture prices' from (values('2025-01-10'::date,33000),('2025-02-10'::date,36000),('2025-04-10'::date,27000))t(d,c);
do $$ begin
 if public.backtest_leg('81000000-0000-0000-0000-000000000003','2025-01-09',0)->>'reason' is null then raise exception 'Unadjusted accepted';end if;
end $$;
insert into public.prices_daily select stock_id,session_date,'adjusted',open_vnd,high_vnd,low_vnd,close_vnd,volume_shares,source,fetched_at from public.prices_daily where stock_id='81000000-0000-0000-0000-000000000003';
insert into public.market_index_daily(symbol,session_date,open_points,close_points,source,source_url,verified_at)
select 'VNINDEX',d,1000,c,'fixture index','https://example.test/index',now() from(values('2025-01-10'::date,1010),('2025-02-10'::date,1100),('2025-04-10'::date,900))t(d,c);
do $$ declare leg jsonb; begin
 leg:=public.backtest_leg('81000000-0000-0000-0000-000000000003','2025-01-09',0);
 -- Hand: buy next-session open 30,000; sell same-session close 33,000 = +10%.
 if leg->>'entryDate'<>'2025-01-10' or leg->>'exitDate'<>'2025-01-10' or (leg->>'entry')::numeric<>30000 or (leg->>'exit')::numeric<>33000 or leg->>'reason' is not null then raise exception 'Incorrect next-open day leg: %',leg;end if;
 leg:=public.backtest_leg('81000000-0000-0000-0000-000000000003','2025-01-09',1);
 -- Hand: 36,000/30,000-1=20%; index 1,100/1,000-1=10%, same dates.
 if leg->>'exitDate'<>'2025-02-10' or (leg->>'exit')::numeric<>36000 or (leg->>'benchmarkExit')::numeric<>1100 then raise exception 'Wrong month/index';end if;
 leg:=public.backtest_leg('81000000-0000-0000-0000-000000000003','2025-01-09',3);
 if leg->>'exitDate'<>'2025-04-10' or (leg->>'exit')::numeric<>27000 then raise exception 'Wrong quarter';end if;
 leg:=public.backtest_leg('81000000-0000-0000-0000-000000000003','2025-01-30',1);
 if leg->>'targetDate'<>'2025-02-28' then raise exception 'Month-end overflow';end if;
 leg:=public.backtest_leg('81000000-0000-0000-0000-000000000003','2025-01-10',0);
 if leg->>'reason' not like '%khoảng trống%' then raise exception 'Missing calendar weekends silently skipped';end if;
end $$;
-- Client cannot forge market performance, publications, verified sessions or index levels.
set local role anon;
do $$ begin
 perform public.backtest_history('day',null,null,1);
 begin insert into public.ranking_publications(source_run_at,as_of,horizon,model_version,universe_count,eligible_count,items) values(now(),current_date,'day','fake',1,1,'[]');raise exception 'Anon forges history';exception when insufficient_privilege then null;end;
 begin insert into public.market_index_daily values('VNINDEX','2025-01-10',1,2,'fake','https://example.test',now());raise exception 'Anon forges benchmark';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into auth.users(id) values('81000000-0000-0000-0000-000000000001'),('81000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
insert into public.user_settings(risk_preferences) values('{"maxLoss":0.1,"atrMultiple":2,"trailingPercent":0.08,"stopMethod":"percent"}');
do $$ begin
 begin update public.user_settings set risk_preferences='{"maxLoss":0.9,"atrMultiple":2,"trailingPercent":0.08,"stopMethod":"percent"}';raise exception 'Invalid risk accepted';exception when check_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
do $$ begin
 if exists(select 1 from public.user_settings where owner_id='81000000-0000-0000-0000-000000000001') then raise exception 'B reads A risk';end if;
 update public.user_settings set risk_preferences=default where owner_id='81000000-0000-0000-0000-000000000001';
 if found then raise exception 'B overwrites A risk';end if;
end $$;
rollback;
\echo 'BACKTEST DB PASS: immutable observations; no backdating; next-open/month/quarter/index; adjusted-only; calendar gaps; bounded pagination; public read-only; risk A/B RLS'
