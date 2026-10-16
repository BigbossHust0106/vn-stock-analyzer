begin;
-- Observed publications, never a reconstruction from today's financials.
create table public.ranking_publications (
 id uuid primary key default gen_random_uuid(),
 recorded_at timestamptz not null default clock_timestamp(),
 source_run_at timestamptz not null,
 as_of date not null,
 horizon public.ranking_horizon not null,
 model_version text not null,
 policy text not null default 'observed-next-open-v1',
 universe_count integer not null check(universe_count>=0),
 eligible_count integer not null check(eligible_count>=0),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=10),
 unique(source_run_at,horizon,model_version)
);
create index ranking_publications_page on public.ranking_publications(horizon,recorded_at desc,id desc);
alter table public.ranking_publications enable row level security;
alter table public.ranking_publications force row level security;
create policy market_read on public.ranking_publications for select to anon,authenticated using(true);
revoke all on public.ranking_publications from public,anon,authenticated;
grant select on public.ranking_publications to anon,authenticated;
grant select,insert on public.ranking_publications to service_role;
create function public.immutable_publication() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Publication is immutable'; end $$;
create trigger immutable_publication before update or delete on public.ranking_publications for each row execute function public.immutable_publication();
create function public.capture_ranking_publication() returns trigger language plpgsql security invoker set search_path='' as $$
declare h public.ranking_horizon; members jsonb; n integer;
begin
 foreach h in array enum_range(null::public.ranking_horizon) loop
  select count(*) into n from public.rankings r where r.as_of=new.as_of and r.horizon=h and r.model_version=new.model_version;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.position),'[]'::jsonb) into members from (
   select r.stock_id,s.symbol,s.name,c.value score,row_number() over(order by c.value desc,s.symbol) position,c.explanation,c.inputs_as_of,c.financial_version,c.quote_version
   from public.rankings r join public.scores c on c.id=r.score_id join public.stocks s on s.id=r.stock_id
   where r.as_of=new.as_of and r.horizon=h and r.model_version=new.model_version and s.active and public.ranking_is_eligible(c.explanation)
   order by c.value desc,s.symbol limit 10
  ) t;
  insert into public.ranking_publications(source_run_at,as_of,horizon,model_version,universe_count,eligible_count,items)
  values(new.computed_at,new.as_of,h,new.model_version,new.universe_count,n,members) on conflict do nothing;
 end loop;
 return new;
end $$;
create trigger capture_ranking_publication after insert or update on public.ranking_runs for each row execute function public.capture_ranking_publication();
revoke all on function public.capture_ranking_publication(),public.immutable_publication() from public,anon,authenticated;
grant execute on function public.capture_ranking_publication(),public.immutable_publication() to service_role;
-- A migration-time observation of the latest publication, recorded NOW. No old dates backfilled.
do $$ begin
 if exists(select 1 from public.ranking_runs) then
  update public.ranking_runs set computed_at=computed_at where as_of=(select max(as_of) from public.ranking_runs);
 end if;
end $$;

-- Index levels are points, never VND and never synthetic stock rows.
create table public.market_index_daily (
 symbol text not null check(symbol='VNINDEX'),
 session_date date not null references public.trading_sessions(session_date),
 open_points numeric not null check(open_points>0 and open_points<1e9),
 close_points numeric not null check(close_points>0 and close_points<1e9),
 source text not null check(length(source)>0),
 source_url text not null check(source_url ~ '^https://'),
 verified_at timestamptz not null check(isfinite(verified_at)),
 primary key(symbol,session_date)
);
alter table public.market_index_daily enable row level security;
alter table public.market_index_daily force row level security;
create policy market_read on public.market_index_daily for select to anon,authenticated using(true);
revoke all on public.market_index_daily from public,anon,authenticated;
grant select on public.market_index_daily to anon,authenticated;
grant all on public.market_index_daily to service_role;

-- Only the next verified session after observation; no signal-day close fill.
create function public.backtest_leg(sid uuid, observed timestamptz, months integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare first_day date; entry_day date; target_day date; exit_day date; p record; q record; b record; e record; reason text;
begin
 if observed is null or not isfinite(observed) or months not in(0,1,3) then raise exception 'Invalid backtest input';end if;
 first_day:=(observed at time zone 'Asia/Ho_Chi_Minh')::date+1;
 select session_date into entry_day from public.trading_sessions where session_date between first_day and first_day+7 and is_open order by session_date limit 1;
 if entry_day is null then return jsonb_build_object('reason','Không đủ dữ liệu: lịch phiên kế tiếp chưa xác minh.');end if;
 if exists(select 1 from generate_series(0,entry_day-first_day) g where not exists(select 1 from public.trading_sessions s where s.session_date=first_day+g)) then return jsonb_build_object('reason','Không đủ dữ liệu: lịch có khoảng trống trước phiên mua.');end if;
 target_day:=case when months=0 then entry_day else (entry_day+make_interval(months=>months))::date end;
 select session_date into exit_day from public.trading_sessions where session_date between target_day and target_day+7 and is_open order by session_date limit 1;
 if exit_day is null or exists(select 1 from public.trading_sessions where session_date=exit_day and closes_at>now()) then
  return jsonb_build_object('entryDate',entry_day,'targetDate',target_day,'reason','Chưa đủ kỳ quan sát hoặc chưa có lịch phiên bán xác minh.');
 end if;
 if exists(select 1 from generate_series(0,exit_day-target_day) g where not exists(select 1 from public.trading_sessions s where s.session_date=target_day+g)) then reason:='Không đủ dữ liệu: lịch có khoảng trống trước phiên bán.';end if;
 select open_vnd,source into p from public.prices_daily where stock_id=sid and session_date=entry_day and price_basis='adjusted' and fetched_at<=now();
 select close_vnd,source into q from public.prices_daily where stock_id=sid and session_date=exit_day and price_basis='adjusted' and fetched_at<=now();
 if p.open_vnd is null or q.close_vnd is null or p.source<>q.source then reason:=coalesce(reason,'Không đủ dữ liệu: thiếu giá điều chỉnh cùng nguồn tại phiên mua/bán.');end if;
 select open_points,source,source_url into b from public.market_index_daily where symbol='VNINDEX' and session_date=entry_day and verified_at<=now();
 select close_points,source into e from public.market_index_daily where symbol='VNINDEX' and session_date=exit_day and verified_at<=now();
 return jsonb_build_object('entryDate',entry_day,'targetDate',target_day,'exitDate',exit_day,'entry',p.open_vnd,'exit',q.close_vnd,'source',p.source,'benchmarkEntry',case when b.source=e.source then b.open_points end,'benchmarkExit',case when b.source=e.source then e.close_points end,'benchmarkSource',b.source_url,'reason',reason);
end $$;
revoke all on function public.backtest_leg(uuid,timestamptz,integer) from public;
grant execute on function public.backtest_leg(uuid,timestamptz,integer) to anon,authenticated,service_role;
create function public.backtest_history(period public.ranking_horizon, before_time timestamptz default null, before_id uuid default null, take integer default 10) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if take not between 1 and 10 or (before_time is null)<>(before_id is null) then raise exception 'Invalid pagination';end if;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('legs',(
  select jsonb_object_agg(h,coalesce((select jsonb_agg(public.backtest_leg((m->>'stock_id')::uuid,c.recorded_at,n)||jsonb_build_object('symbol',m->>'symbol')) from jsonb_array_elements(c.items) m),'[]'::jsonb))
  from (values('day',0),('month',1),('quarter',3)) periods(h,n)
 )) order by c.recorded_at desc,c.id desc),'[]'::jsonb) into result
 from (select * from public.ranking_publications where horizon=period and (before_time is null or (recorded_at,id)<(before_time,before_id)) order by recorded_at desc,id desc limit take) c;
 return result;
end $$;
revoke all on function public.backtest_history(public.ranking_horizon,timestamptz,uuid,integer) from public;
grant execute on function public.backtest_history(public.ranking_horizon,timestamptz,uuid,integer) to anon,authenticated,service_role;

-- Diagnostic only: reported bars, explicitly unverified, not historical Top 10.
create function public.reported_price_check(ticker text, start_day date, provider text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare sid uuid; p record; q record; h text; n integer; target date; result jsonb:='{}';
begin
 if ticker !~ '^[A-Z0-9]{3,12}$' or provider not in('VPS','KBS') or start_day is null or start_day<(now() at time zone 'Asia/Ho_Chi_Minh')::date-1100 or start_day>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Invalid price check';end if;
 select id into sid from public.stocks where symbol=ticker;
 select session_date,open_vnd into p from public.prices_history where stock_id=sid and source=provider and session_date between start_day and start_day+7 and session_date<(now() at time zone 'Asia/Ho_Chi_Minh')::date order by session_date limit 1;
 for h,n in select * from (values('day',0),('month',1),('quarter',3)) t(h,n) loop
  target:=(p.session_date+make_interval(months=>n))::date;
  select session_date,close_vnd into q from public.prices_history where stock_id=sid and source=provider and session_date between target and target+7 and session_date<(now() at time zone 'Asia/Ho_Chi_Minh')::date order by session_date limit 1;
  result:=result||jsonb_build_object(h,jsonb_build_object('symbol',ticker,'entryDate',p.session_date,'targetDate',target,'exitDate',q.session_date,'entry',p.open_vnd,'exit',q.close_vnd,'source',provider,'reason',case when p.open_vnd is null or q.close_vnd is null then 'Không đủ dữ liệu giá báo cáo cho kỳ này.' end));
 end loop;
 return result;
end $$;
revoke all on function public.reported_price_check(text,date,text) from public;
grant execute on function public.reported_price_check(text,date,text) to anon,authenticated,service_role;

alter table public.user_settings add column risk_preferences jsonb not null default '{"maxLoss":0.08,"atrMultiple":2,"stopMethod":"atr","trailingPercent":0.08}'::jsonb;
create function public.valid_risk_preferences(p jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object' and jsonb_typeof(p->'maxLoss')='number' and jsonb_typeof(p->'atrMultiple')='number' and jsonb_typeof(p->'trailingPercent')='number' and (p->>'maxLoss')::numeric between .005 and .3 and (p->>'atrMultiple')::numeric between .5 and 5 and (p->>'trailingPercent')::numeric between .005 and .3 and p->>'stopMethod' in('atr','swing','percent'),false);
$$;
revoke all on function public.valid_risk_preferences(jsonb) from public;
grant execute on function public.valid_risk_preferences(jsonb) to authenticated,service_role;
alter table public.user_settings add constraint risk_preferences_valid check(public.valid_risk_preferences(risk_preferences));
-- Foreign-key/RLS lookups and existing owner-filtered pagination.
create index if not exists notifications_owner_created_idx on public.notifications(owner_id,created_at desc,id desc);
notify pgrst,'reload schema';
commit;
