begin;
-- Data availability only. This list is not an investment ranking or a bypass of Top10 eligibility.
create function public.search_stocks_by_coverage(q text, market text default null)
returns table(symbol text,name text,exchange public.exchange_code,source text,coverage double precision,graham_coverage double precision,buffett_coverage double precision,annual_years integer,latest_year integer,financial_fetched_at timestamptz)
language sql stable security invoker set search_path='' as $$
 with candidates as (
 select s.*,f.payload,f.fetched_at as financial_stamp,f.version as financial_version
 from public.stocks s left join public.financial_snapshots f on f.stock_id=s.id
 where s.active and (market is null or s.exchange::text=market)
 and (q='' or s.search_text like '%'||replace(replace(q,'%','\%'),'_','\_')||'%' escape '\')
 ), coverage_rows as (
 select c.*,coalesce((r.explanation->'strategies'->0->>'coverage')::float8,0) as gc,
 coalesce((r.explanation->'strategies'->1->>'coverage')::float8,0) as bc,
 coalesce(jsonb_array_length(c.payload->'annual'),0) as years,
 (select max((a->>'year')::integer) from jsonb_array_elements(c.payload->'annual') a) as last_year
 from candidates c left join lateral (
 select sc.explanation from public.scores sc where sc.stock_id=c.id and sc.financial_version=c.financial_version
 and jsonb_typeof(sc.explanation->'strategies')='array' order by sc.computed_at desc limit 1
 ) r on true
 )
 select c.symbol,c.name,c.exchange,c.source,least(1::float8,greatest(0::float8,(c.gc+c.bc)/2)),
 least(1::float8,greatest(0::float8,c.gc)),least(1::float8,greatest(0::float8,c.bc)),c.years,c.last_year,c.financial_stamp
 from coverage_rows c
 order by case when q='' then 0 when lower(c.symbol)=q then 0 when lower(c.symbol) like replace(replace(q,'%','\%'),'_','\_')||'%' escape '\' then 1 else 2 end,
 (c.gc+c.bc)/2 desc,c.last_year desc nulls last,c.years desc,c.symbol limit 20
$$;
revoke all on function public.search_stocks_by_coverage(text,text) from public;
grant execute on function public.search_stocks_by_coverage(text,text) to anon,authenticated,service_role;
commit;
