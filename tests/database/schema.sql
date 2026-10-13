\set ON_ERROR_STOP on
begin;
insert into public.stocks(id,symbol,exchange,name) values('20000000-0000-4000-8000-000000000009','TST','HOSE','Synthetic DB test — không phải fixture VPS');
insert into public.trading_sessions(session_date,is_open,closes_at,source,verified_at) values('2020-01-02',true,'2020-01-02T08:00:00Z','synthetic test',now());
set local role service_role;
select public.ingest_current_quotes('[{"symbol":"TST","reference_vnd":10,"ceiling_vnd":12,"floor_vnd":9,"last_price_vnd":11,"bid3_price_vnd":10,"last_volume_raw":100,"lot_raw":100,"fetched_at":"2020-01-02T08:00:00Z"}]');
select public.ingest_current_quotes('[{"symbol":"TST","reference_vnd":10,"ceiling_vnd":12,"floor_vnd":9,"last_price_vnd":10,"bid3_price_vnd":10,"last_volume_raw":100,"lot_raw":100,"fetched_at":"2020-01-02T07:00:00Z"}]');
do $$ begin
  if (select total_volume_shares from public.prices_current) <> 1000 or (select last_volume_raw from public.prices_current) <> 100 then raise exception 'Lot scaling applies to wrong volume'; end if;
  if (select count(*) from public.prices_current) <> 1 or (select last_price_vnd from public.prices_current) <> 11 then raise exception 'Ingest not idempotent or stale overwrote new'; end if;
  begin
    perform public.ingest_current_quotes('[{"symbol":"XXX"}]');
    raise exception 'Unknown stock accepted';
  exception when raise_exception then if sqlerrm <> 'Unknown or inactive symbol' then raise; end if; end;
  begin
    perform public.ingest_current_quotes('[]');
    raise exception 'Empty quotes accepted';
  exception when raise_exception then if sqlerrm <> 'No quotes' then raise; end if; end;
end $$;
reset role;
update public.stocks set search_text='tst synthetic db' where symbol='TST';
set local role service_role;
select public.ingest_price_history('[{"stock_id":"20000000-0000-4000-8000-000000000009","session_date":"2020-01-02","source":"VPS","open_vnd":10,"high_vnd":12,"low_vnd":9,"close_vnd":11,"volume_reported":100,"is_final":true,"fetched_at":"2020-01-02T08:00:00Z"}]');
select public.ingest_price_history('[{"stock_id":"20000000-0000-4000-8000-000000000009","session_date":"2020-01-02","source":"VPS","open_vnd":10,"high_vnd":12,"low_vnd":9,"close_vnd":10,"volume_reported":100,"is_final":true,"fetched_at":"2020-01-02T07:00:00Z"}]');
do $$ begin
  if (select close_vnd from public.prices_history) <> 11 then raise exception 'Stale history overwrote new'; end if;
  begin perform public.ingest_price_history('[]');raise exception 'Empty history accepted';exception when raise_exception then if sqlerrm <> 'No history' then raise;end if;end;
end $$;
set local role anon;
do $$ begin
  if (select count(*) from public.prices_history) <> 1 then raise exception 'Anon cannot read history';end if;
  if (select count(*) from public.search_stocks('synthetic')) <> 1 then raise exception 'Name search failed';end if;
  if (select count(*) from public.search_stocks('%')) <> 0 then raise exception 'Wildcard search not escaped';end if;
  begin perform public.ingest_price_history('[]');raise exception 'Anon can ingest history';exception when insufficient_privilege then null;end;
  begin delete from public.prices_history;raise exception 'Anon can delete history';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
  begin
    insert into public.prices_daily(stock_id,session_date,price_basis,open_vnd,high_vnd,low_vnd,close_vnd,volume_shares,source) values('20000000-0000-4000-8000-000000000009','2020-01-02','adjusted',10,9,8,11,1,'synthetic');
    raise exception 'Invalid OHLC accepted';
  exception when check_violation then null; end;
  begin
    insert into public.scores(stock_id,as_of,horizon,model_version,value,inputs_as_of) values('20000000-0000-4000-8000-000000000009','2020-01-02','day','test',101,now());
    raise exception 'Invalid score accepted';
  exception when check_violation then null; end;
  begin
    insert into public.scores(stock_id,as_of,horizon,model_version,value,inputs_as_of) values('20000000-0000-4000-8000-000000000009','2020-01-02','day','test',null,now());
    raise exception 'Missing insufficient reason accepted';
  exception when check_violation then null; end;
end $$;
rollback;
\echo SCHEMA PASS: constraints, service-role RPC, idempotency, stale/unknown/empty quote rejection
