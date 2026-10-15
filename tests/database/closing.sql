\set ON_ERROR_STOP on
begin;
insert into public.stocks(id,symbol,exchange,name) values('20000000-0000-4000-8000-000000000099','CLT','HOSE','Synthetic closing cache test');
set local role service_role;
select public.cache_reported_close('20000000-0000-4000-8000-000000000099','VPS',(now() at time zone 'Asia/Ho_Chi_Minh')::date-1,20450,now());
-- A stale source observation must not replace the newer closing session.
select public.cache_reported_close('20000000-0000-4000-8000-000000000099','VPS',(now() at time zone 'Asia/Ho_Chi_Minh')::date-2,1,now());
do $$ begin
 if (select price_vnd from public.stock_closing_snapshots where stock_id='20000000-0000-4000-8000-000000000099') is distinct from 20450 then raise exception 'Stale close replaced latest'; end if;
 begin perform public.cache_reported_close('20000000-0000-4000-8000-000000000099','VPS',(now() at time zone 'Asia/Ho_Chi_Minh')::date,22000,now());raise exception 'Current session accepted';exception when raise_exception then if sqlerrm='Current session accepted' then raise;end if;end;
end $$;
set local role anon;
do $$ begin
 if not exists(select 1 from public.stock_closing_snapshots where stock_id='20000000-0000-4000-8000-000000000099' and finality='unverified' and price_vnd=20450) then raise exception 'Public closing read failed';end if;
 begin perform public.cache_reported_close('20000000-0000-4000-8000-000000000099','VPS',current_date-1,1,now());raise exception 'Anon writes close';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
\echo CLOSING CACHE PASS: prior-date only, stale refusal, public read, service-only write, finality unverified
