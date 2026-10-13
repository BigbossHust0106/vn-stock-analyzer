begin;
alter table public.stocks add column source text not null default 'unverified';
alter table public.stocks add column source_verified_at timestamptz;
alter table public.stocks add column search_text text not null default '';
create index stocks_search_text_idx on public.stocks(search_text);

-- Dữ liệu nguồn chưa chứng nhận adjusted/unadjusted, không ghi vào prices_daily
-- vốn yêu cầu price basis và lịch phiên đã xác minh. Không biến bar thành calendar.
create table public.prices_history (
  stock_id uuid not null references public.stocks(id),
  session_date date not null,
  source text not null check (source in ('VPS','KBS')),
  open_vnd numeric(24,6) not null check(open_vnd > 0 and open_vnd <> 'NaN'::numeric),
  high_vnd numeric(24,6) not null check(high_vnd > 0 and high_vnd <> 'NaN'::numeric),
  low_vnd numeric(24,6) not null check(low_vnd > 0 and low_vnd <> 'NaN'::numeric),
  close_vnd numeric(24,6) not null check(close_vnd > 0 and close_vnd <> 'NaN'::numeric),
  volume_reported bigint not null check(volume_reported between 0 and 9007199254740991),
  volume_unit text not null default 'shares' check(volume_unit = 'shares'),
  price_basis text not null default 'unverified' check(price_basis = 'unverified'),
  is_final boolean not null default false,
  fetched_at timestamptz not null,
  primary key(stock_id,source,session_date),
  check(high_vnd >= greatest(open_vnd,close_vnd,low_vnd) and low_vnd <= least(open_vnd,close_vnd))
);
create index prices_history_session_idx on public.prices_history(session_date desc,stock_id,source);
alter table public.prices_history enable row level security;
alter table public.prices_history force row level security;
create policy market_read on public.prices_history for select to anon,authenticated using(true);
revoke all on public.prices_history from anon,authenticated;
grant select on public.prices_history to anon,authenticated;
grant all on public.prices_history to service_role;

create function public.search_stocks(q text, market text default null)
returns table(symbol text,name text,exchange public.exchange_code,source text)
language sql stable security invoker set search_path = '' as $$
  select s.symbol,s.name,s.exchange,s.source from public.stocks s
  where s.active and (market is null or s.exchange::text=market)
    and (q='' or s.search_text like '%' || replace(replace(q,'%','\%'),'_','\_') || '%' escape '\')
  order by case when lower(s.symbol)=q then 0 when lower(s.symbol) like q || '%' then 1 else 2 end,s.symbol
  limit 20
$$;
revoke all on function public.search_stocks(text,text) from public;
grant execute on function public.search_stocks(text,text) to anon,authenticated,service_role;
create function public.ingest_price_history(rows jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows)=0 then raise exception 'No history'; end if;
  insert into public.prices_history(stock_id,session_date,source,open_vnd,high_vnd,low_vnd,close_vnd,volume_reported,is_final,fetched_at)
  select r.stock_id,r.session_date,r.source,r.open_vnd,r.high_vnd,r.low_vnd,r.close_vnd,r.volume_reported,r.is_final,r.fetched_at
  from jsonb_to_recordset(rows) as r(stock_id uuid,session_date date,source text,open_vnd numeric,high_vnd numeric,low_vnd numeric,close_vnd numeric,volume_reported bigint,is_final boolean,fetched_at timestamptz)
  on conflict(stock_id,source,session_date) do update set open_vnd=excluded.open_vnd,high_vnd=excluded.high_vnd,low_vnd=excluded.low_vnd,close_vnd=excluded.close_vnd,volume_reported=excluded.volume_reported,is_final=excluded.is_final,fetched_at=excluded.fetched_at
  where excluded.fetched_at > public.prices_history.fetched_at;
end $$;
revoke all on function public.ingest_price_history(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_price_history(jsonb) to service_role;
commit;
