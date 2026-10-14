begin;
create table public.ranking_reference_prices (
 stock_id uuid primary key references public.stocks(id),
 reference_vnd numeric(24,6) not null check(reference_vnd>0 and reference_vnd<1e12),
 source_url text not null check(source_url='https://kbbuddywts.kbsec.com.vn/iis-server/investment/stock/search/data'),
 fetched_at timestamptz not null
);
alter table public.ranking_reference_prices enable row level security;
alter table public.ranking_reference_prices force row level security;
create policy market_read on public.ranking_reference_prices for select to anon,authenticated using(true);
revoke all on public.ranking_reference_prices from anon,authenticated;
grant select on public.ranking_reference_prices to anon,authenticated;
grant all on public.ranking_reference_prices to service_role;
create or replace function public.top_rankings(period public.ranking_horizon, market text default null, industry text default null, min_cap numeric default null, max_cap numeric default null)
returns table(stock_id uuid,symbol text,name text,exchange public.exchange_code,sector text,"position" bigint,as_of date,computed_at timestamptz,score numeric,explanation jsonb,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,s.exchange,s.sector,row_number() over(order by c.value desc,s.symbol),r.as_of,c.computed_at,c.value,c.explanation || jsonb_build_object('quoteSource',case when q.fetched_at>=now()-interval '24 hours' then 'VPS' else 'KBS reference' end),
 case when q.fetched_at>=now()-interval '24 hours' then q.last_price_vnd else null end,
 case when q.fetched_at>=now()-interval '24 hours' then q.reference_vnd else ref.reference_vnd end,
 case when q.fetched_at>=now()-interval '24 hours' then q.fetched_at else ref.fetched_at end
 from public.rankings r join public.scores c on c.id=r.score_id join public.stocks s on s.id=r.stock_id left join public.prices_current q on q.stock_id=s.id left join public.ranking_reference_prices ref on ref.stock_id=s.id
 where r.model_version='top10-v1' and r.horizon=period and r.as_of=(select max(t.as_of) from public.ranking_runs t where t.model_version='top10-v1') and s.active
 and (market is null or s.exchange::text=market) and (industry is null or s.sector=industry)
 and (min_cap is null or (c.explanation->>'marketCapVnd')::numeric>=min_cap) and (max_cap is null or (c.explanation->>'marketCapVnd')::numeric<max_cap)
 order by c.value desc,s.symbol limit 10;
$$;
create or replace function public.watchlist_snapshot(list_id uuid, period public.ranking_horizon default 'quarter')
returns table(stock_id uuid,symbol text,name text,notes text,target_price_vnd numeric,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz,score numeric,previous_score numeric,score_as_of date,previous_as_of date,explanation jsonb)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,i.notes,i.target_price_vnd,
 case when q.fetched_at>=now()-interval '24 hours' then q.last_price_vnd else null end,
 case when q.fetched_at>=now()-interval '24 hours' then q.reference_vnd else ref.reference_vnd end,
 case when q.fetched_at>=now()-interval '24 hours' then q.fetched_at else ref.fetched_at end,
 c.value,p.value,c.as_of,p.as_of,coalesce(c.explanation,'{}'::jsonb) || jsonb_build_object('quoteSource',case when q.fetched_at>=now()-interval '24 hours' then 'VPS' else 'KBS reference' end)
 from public.watchlist_items i join public.stocks s on s.id=i.stock_id left join public.prices_current q on q.stock_id=s.id left join public.ranking_reference_prices ref on ref.stock_id=s.id
 left join lateral(select x.* from public.scores x where x.stock_id=s.id and x.horizon=period and x.model_version='top10-v1' order by x.as_of desc limit 1)c on true
 left join lateral(select x.* from public.scores x where x.stock_id=s.id and x.horizon=period and x.model_version='top10-v1' and x.as_of<c.as_of order by x.as_of desc limit 1)p on true
 where i.watchlist_id=list_id and i.owner_id=(select auth.uid()) order by s.symbol;
$$;
commit;
