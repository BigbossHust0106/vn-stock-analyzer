\set ON_ERROR_STOP on
begin;
insert into public.stocks(id,symbol,name,exchange,search_text,source) values('96000000-0000-4000-8000-000000000026','IO1','Synthetic IO fixture','HOSE','io1 synthetic','KBS');
set local role service_role;
select public.ingest_price_history('[{"stock_id":"96000000-0000-4000-8000-000000000026","session_date":"2026-10-20","source":"KBS","open_vnd":20,"high_vnd":22,"low_vnd":19,"close_vnd":21,"volume_reported":100,"is_final":false,"fetched_at":"2026-10-21T00:00:00Z"}]');
do $$declare before_tid tid;after_tid tid;begin
 select ctid into before_tid from public.prices_history where stock_id='96000000-0000-4000-8000-000000000026';
 perform public.ingest_price_history('[{"stock_id":"96000000-0000-4000-8000-000000000026","session_date":"2026-10-20","source":"KBS","open_vnd":20,"high_vnd":22,"low_vnd":19,"close_vnd":21,"volume_reported":100,"is_final":false,"fetched_at":"2026-10-22T00:00:00Z"}]');
 select ctid into after_tid from public.prices_history where stock_id='96000000-0000-4000-8000-000000000026';
 if before_tid<>after_tid then raise exception 'Unchanged history rewrote heap tuple';end if;
 perform public.ingest_price_history('[{"stock_id":"96000000-0000-4000-8000-000000000026","session_date":"2026-10-20","source":"KBS","open_vnd":20,"high_vnd":22,"low_vnd":19,"close_vnd":22,"volume_reported":110,"is_final":false,"fetched_at":"2026-10-22T00:00:00Z"}]');
 if (select close_vnd from public.prices_history where stock_id='96000000-0000-4000-8000-000000000026')<>22 then raise exception 'Real history correction was lost';end if;
end $$;
select public.ingest_current_quotes('[{"symbol":"IO1","reference_vnd":20,"ceiling_vnd":22,"floor_vnd":18,"last_price_vnd":21,"bid3_price_vnd":20,"last_volume_raw":10,"lot_raw":100,"fetched_at":"2026-10-26T00:00:00Z"}]');
do $$declare v uuid; t tid;begin
 select version,ctid into v,t from public.prices_current where stock_id='96000000-0000-4000-8000-000000000026';
 perform public.ingest_current_quotes('[{"symbol":"IO1","reference_vnd":20,"ceiling_vnd":22,"floor_vnd":18,"last_price_vnd":21,"bid3_price_vnd":20,"last_volume_raw":10,"lot_raw":100,"fetched_at":"2026-10-26T00:00:10Z"}]');
 if exists(select 1 from public.prices_current where stock_id='96000000-0000-4000-8000-000000000026' and (version<>v or ctid<>t)) then raise exception 'Duplicate quote caused write/version churn';end if;
 perform public.ingest_current_quotes('[{"symbol":"IO1","reference_vnd":20,"ceiling_vnd":22,"floor_vnd":18,"last_price_vnd":22,"bid3_price_vnd":20,"last_volume_raw":10,"lot_raw":101,"fetched_at":"2026-10-26T00:00:11Z"}]');
 if not exists(select 1 from public.prices_current where stock_id='96000000-0000-4000-8000-000000000026' and last_price_vnd=22 and total_volume_shares=1010 and version<>v) then raise exception 'Changed quote must be persisted immediately with correct shares';end if;
 select version into v from public.prices_current where stock_id='96000000-0000-4000-8000-000000000026';
 perform public.ingest_current_quotes('[{"symbol":"IO1","reference_vnd":20,"ceiling_vnd":22,"floor_vnd":18,"last_price_vnd":22,"bid3_price_vnd":20,"last_volume_raw":10,"lot_raw":101,"fetched_at":"2026-10-26T00:01:12Z"}]');
 if exists(select 1 from public.prices_current where stock_id='96000000-0000-4000-8000-000000000026' and (version=v or fetched_at<>'2026-10-26T00:01:12Z'::timestamptz)) then raise exception 'Observation heartbeat not retained after minute';end if;
end $$;
insert into public.fundamentals(stock_id,period_end,period_basis,eps_vnd,published_at,source,financial_payload,fetched_at)
values('96000000-0000-4000-8000-000000000026','2025-12-31','annual',4,'2026-01-01','KBS_VIETCAP','{"epsAnnualVnd":4}','2026-10-21');
do $$declare t tid;begin
 select ctid into t from public.fundamentals where stock_id='96000000-0000-4000-8000-000000000026';
 update public.fundamentals set fetched_at='2026-10-22' where stock_id='96000000-0000-4000-8000-000000000026';
 if exists(select 1 from public.fundamentals where stock_id='96000000-0000-4000-8000-000000000026' and ctid<>t) then raise exception 'Unchanged fundamentals created a new heap version';end if;
 update public.fundamentals set eps_vnd=5 where stock_id='96000000-0000-4000-8000-000000000026';
 if exists(select 1 from public.fundamentals where stock_id='96000000-0000-4000-8000-000000000026' and eps_vnd<>5) then raise exception 'Real fundamental correction lost';end if;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform public.ingest_current_quotes('[]');raise exception 'Anon quote write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
\echo 'IO SQL PASS: unchanged history/quote retain heap tuple, real corrections persist, minute heartbeat retained, anon writes denied'
