begin;
-- A small, separate cache for display-only previous closes. Do not mix a recent
-- history slice into a three-year series whose adjustment basis is unverified.
create table public.stock_closing_snapshots (
 stock_id uuid not null references public.stocks(id),
 source text not null check(source in ('VPS','KBS')),
 session_date date not null,
 price_vnd numeric(24,6) not null check(price_vnd>0 and price_vnd<1e12),
 fetched_at timestamptz not null,
 finality text not null default 'unverified' check(finality='unverified'),
 primary key(stock_id,source)
);
alter table public.stock_closing_snapshots enable row level security;
alter table public.stock_closing_snapshots force row level security;
create policy market_read on public.stock_closing_snapshots for select to anon,authenticated using(true);
revoke all on public.stock_closing_snapshots from public,anon,authenticated;
grant select on public.stock_closing_snapshots to anon,authenticated;
grant select,insert,update on public.stock_closing_snapshots to service_role;
create function public.cache_reported_close(sid uuid,provider text,day date,price numeric,stamp timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if day is null or day>=(now() at time zone 'Asia/Ho_Chi_Minh')::date or stamp is null or not isfinite(stamp) or stamp>now()+interval '5 minutes' then raise exception 'Invalid closing observation'; end if;
 insert into public.stock_closing_snapshots(stock_id,source,session_date,price_vnd,fetched_at)
 values(sid,provider,day,price,stamp)
 on conflict(stock_id,source) do update set session_date=excluded.session_date,price_vnd=excluded.price_vnd,fetched_at=excluded.fetched_at
 where excluded.session_date>=stock_closing_snapshots.session_date and excluded.fetched_at>=stock_closing_snapshots.fetched_at;
end $$;
revoke all on function public.cache_reported_close(uuid,text,date,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.cache_reported_close(uuid,text,date,numeric,timestamptz) to service_role;
commit;
