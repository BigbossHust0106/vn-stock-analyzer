begin;
alter table public.stocks add column sector text, add column sector_source_url text;
alter table public.stocks add constraint sector_source_required check (sector is null or (length(sector) between 1 and 120 and sector_source_url ~ '^https://'));
alter table public.watchlist_items add column notes text not null default '' check (length(notes)<=2000), add column target_price_vnd numeric(24,6) check (target_price_vnd>0 and target_price_vnd<1e12), add column updated_at timestamptz not null default now();
create table public.corporate_events (
 id uuid primary key default gen_random_uuid(), stock_id uuid not null references public.stocks(id),
 kind text not null check(kind in ('earnings','dividend','agm')), event_date date not null,
 title text not null check(length(title) between 1 and 300), source_url text not null check(source_url ~ '^https://'),
 known_at timestamptz not null, unique(stock_id,kind,event_date,source_url)
);
create index corporate_events_date_idx on public.corporate_events(stock_id,event_date);
alter table public.corporate_events enable row level security;
alter table public.corporate_events force row level security;
create policy market_read on public.corporate_events for select to anon,authenticated using(true);
revoke all on public.corporate_events from anon,authenticated;
grant select on public.corporate_events to anon,authenticated;
grant all on public.corporate_events to service_role;
create table public.ranking_runs (
 as_of date not null, model_version text not null, computed_at timestamptz not null,
 universe_count integer not null check(universe_count>=0), primary key(as_of,model_version)
);
alter table public.ranking_runs enable row level security;
alter table public.ranking_runs force row level security;
create policy market_read on public.ranking_runs for select to anon,authenticated using(true);
revoke all on public.ranking_runs from anon,authenticated;
grant select on public.ranking_runs to anon,authenticated;
grant all on public.ranking_runs to service_role;
create index scores_latest_idx on public.scores(stock_id,horizon,model_version,as_of desc);
-- Publication atomique des trois horizons; droits exclusivement service_role.
create function public.publish_rankings(day date, stamp timestamptz, rows jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare n integer; previous timestamptz;
begin
 if day is null or stamp is null or not isfinite(stamp) or day <> (stamp at time zone 'Asia/Ho_Chi_Minh')::date or stamp>now()+interval '5 minutes' or jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)=0 then raise exception 'Invalid ranking batch'; end if;
 perform pg_advisory_xact_lock(740104);
 select computed_at into previous from public.ranking_runs where as_of=day and model_version='top10-v1';
 if previous is not null and previous>stamp then return; end if;
 select count(distinct r->>'stock_id') into n from jsonb_array_elements(rows) r;
 if jsonb_array_length(rows)<>n*3 or exists(select 1 from jsonb_array_elements(rows) r group by r->>'stock_id' having count(distinct r->>'horizon')<>3) then raise exception 'Incomplete ranking horizons'; end if;
 delete from public.rankings where as_of=day and model_version='top10-v1';
 insert into public.scores(stock_id,as_of,horizon,model_version,value,insufficient_reason,inputs_as_of,computed_at,explanation)
 select r.stock_id,day,r.horizon,'top10-v1',r.value,r.insufficient_reason,r.inputs_as_of,stamp,r.explanation
 from jsonb_to_recordset(rows) as r(stock_id uuid,horizon public.ranking_horizon,value numeric,insufficient_reason text,inputs_as_of timestamptz,explanation jsonb)
 on conflict(stock_id,as_of,horizon,model_version) do update set value=excluded.value,insufficient_reason=excluded.insufficient_reason,inputs_as_of=excluded.inputs_as_of,computed_at=excluded.computed_at,explanation=excluded.explanation;
 insert into public.rankings(as_of,horizon,model_version,stock_id,score_id,position)
 select day,horizon,'top10-v1',stock_id,id,row_number() over(partition by horizon order by value desc,stock_id)
 from public.scores where as_of=day and model_version='top10-v1' and value is not null and stock_id in(select (r->>'stock_id')::uuid from jsonb_array_elements(rows) r);
 insert into public.ranking_runs values(day,'top10-v1',stamp,n) on conflict(as_of,model_version) do update set computed_at=excluded.computed_at,universe_count=excluded.universe_count;
 update public.system_status set state='ok',last_success_at=stamp,updated_at=now() where component='rankings';
end $$;
revoke all on function public.publish_rankings(date,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.publish_rankings(date,timestamptz,jsonb) to service_role;
create function public.top_rankings(period public.ranking_horizon, market text default null, industry text default null, min_cap numeric default null, max_cap numeric default null)
returns table(stock_id uuid,symbol text,name text,exchange public.exchange_code,sector text,"position" bigint,as_of date,computed_at timestamptz,score numeric,explanation jsonb,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,s.exchange,s.sector,row_number() over(order by c.value desc,s.symbol),r.as_of,c.computed_at,c.value,c.explanation,q.last_price_vnd,q.reference_vnd,q.fetched_at
 from public.rankings r join public.scores c on c.id=r.score_id join public.stocks s on s.id=r.stock_id left join public.prices_current q on q.stock_id=s.id
 where r.model_version='top10-v1' and r.horizon=period and r.as_of=(select max(t.as_of) from public.ranking_runs t where t.model_version='top10-v1') and s.active
 and (market is null or s.exchange::text=market) and (industry is null or s.sector=industry)
 and (min_cap is null or (c.explanation->>'marketCapVnd')::numeric>=min_cap) and (max_cap is null or (c.explanation->>'marketCapVnd')::numeric<max_cap)
 order by c.value desc,s.symbol limit 10;
$$;
revoke all on function public.top_rankings(public.ranking_horizon,text,text,numeric,numeric) from public;
grant execute on function public.top_rankings(public.ranking_horizon,text,text,numeric,numeric) to anon,authenticated,service_role;
create function public.watchlist_snapshot(list_id uuid, period public.ranking_horizon default 'quarter')
returns table(stock_id uuid,symbol text,name text,notes text,target_price_vnd numeric,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz,score numeric,previous_score numeric,score_as_of date,previous_as_of date,explanation jsonb)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,i.notes,i.target_price_vnd,q.last_price_vnd,q.reference_vnd,q.fetched_at,c.value,p.value,c.as_of,p.as_of,c.explanation
 from public.watchlist_items i join public.stocks s on s.id=i.stock_id left join public.prices_current q on q.stock_id=s.id
 left join lateral(select x.* from public.scores x where x.stock_id=s.id and x.horizon=period and x.model_version='top10-v1' order by x.as_of desc limit 1)c on true
 left join lateral(select x.* from public.scores x where x.stock_id=s.id and x.horizon=period and x.model_version='top10-v1' and x.as_of<c.as_of order by x.as_of desc limit 1)p on true
 where i.watchlist_id=list_id and i.owner_id=(select auth.uid()) order by s.symbol;
$$;
revoke all on function public.watchlist_snapshot(uuid,public.ranking_horizon) from public,anon;
grant execute on function public.watchlist_snapshot(uuid,public.ranking_horizon) to authenticated;
commit;
