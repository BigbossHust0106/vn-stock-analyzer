begin;

alter table public.fundamentals
  add column revenue_vnd numeric(30,6),
  add column net_profit_vnd numeric(30,6),
  add column parent_profit_vnd numeric(30,6),
  add column roe numeric(18,8),
  add column roa numeric(18,8),
  add column roic numeric(18,8),
  add column gross_margin numeric(18,8),
  add column net_margin numeric(18,8),
  add column debt_to_equity numeric(18,8),
  add column operating_cash_flow_vnd numeric(30,6),
  add column capex_vnd numeric(30,6),
  add column free_cash_flow_vnd numeric(30,6),
  add column dividends_paid_vnd numeric(30,6),
  add column financial_payload jsonb,
  add column fetched_at timestamptz;
alter table public.scores add column explanation jsonb;
alter table public.user_settings add column scoring_preferences jsonb not null default '{"grahamWeight":50,"buffettWeight":50,"growthRate":0.05,"discountRate":0.12,"terminalGrowth":0.02,"projectionYears":5,"maintenanceCapexFraction":1}'::jsonb;

create function public.valid_scoring_preferences(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; a numeric; b numeric; g numeric; r numeric; t numeric; y numeric; m numeric;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  foreach k in array array['grahamWeight','buffettWeight','growthRate','discountRate','terminalGrowth','projectionYears','maintenanceCapexFraction'] loop
    if jsonb_typeof(p->k) is distinct from 'number' then return false; end if;
  end loop;
  a := (p->>'grahamWeight')::numeric; b := (p->>'buffettWeight')::numeric; g := (p->>'growthRate')::numeric;
  r := (p->>'discountRate')::numeric; t := (p->>'terminalGrowth')::numeric; y := (p->>'projectionYears')::numeric; m := (p->>'maintenanceCapexFraction')::numeric;
  return a between 0 and 100 and b between 0 and 100 and a+b=100 and g between -.2 and .2 and r between .03 and .5 and t between -.05 and .05 and t<r and y between 1 and 10 and y=trunc(y) and m between 0 and 1;
end $$;
revoke all on function public.valid_scoring_preferences(jsonb) from public;
grant execute on function public.valid_scoring_preferences(jsonb) to authenticated, service_role;
alter table public.user_settings add constraint scoring_preferences_valid check (public.valid_scoring_preferences(scoring_preferences));

create table public.financial_snapshots (
  stock_id uuid primary key references public.stocks(id),
  source text not null check(source='KBS_VIETCAP'),
  fetched_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object' and jsonb_typeof(payload->'annual')='array')
);
alter table public.financial_snapshots enable row level security;
alter table public.financial_snapshots force row level security;
create policy market_read on public.financial_snapshots for select to anon,authenticated using(true);
revoke all on public.financial_snapshots from anon,authenticated;
grant select on public.financial_snapshots to anon,authenticated;
grant all on public.financial_snapshots to service_role;

create function public.ingest_financials(dataset jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare sid uuid; r jsonb; k text; stamp timestamptz; oldstamp timestamptz;
begin
  if dataset->>'source' is distinct from 'KBS_VIETCAP' or dataset->>'verification' is distinct from 'provider_reported' or jsonb_typeof(dataset->'annual') is distinct from 'array' then raise exception 'Invalid financial source/payload'; end if;
  if jsonb_array_length(dataset->'annual') > 8 then raise exception 'Too many annual periods'; end if;
  select id into strict sid from public.stocks where symbol=dataset->>'symbol' and active=true;
  -- Serialize concurrent writers per stock; an older snapshot must not replace a newer one.
  perform 1 from public.stocks where id=sid for update;
  stamp := (dataset->>'fetchedAt')::timestamptz;
  if stamp is null or stamp>now()+interval '5 minutes' then raise exception 'Invalid fetch timestamp'; end if;
  select fetched_at into oldstamp from public.financial_snapshots where stock_id=sid;
  if oldstamp is not null and oldstamp>stamp then return; end if;
  for r in select value from jsonb_array_elements(dataset->'annual') loop
    if jsonb_typeof(r) is distinct from 'object' or r->>'periodEnd' is distinct from (r->>'year')||'-12-31' or coalesce((r->>'audited')::boolean,false) is not true or coalesce((r->>'consolidated')::boolean,false) is not true or (r->>'publishedAt')::timestamptz > stamp or (r->>'publishedAt')::timestamptz is null then raise exception 'Invalid annual period/publication'; end if;
    foreach k in array array['revenueVnd','netProfitVnd','parentProfitVnd','epsAnnualVnd','bvpsVnd','roe','roa','roic','grossMargin','netMargin','debtToEquity','operatingCashFlowVnd','capexVnd','freeCashFlowVnd','dividendsPaidVnd','sharesOutstanding'] loop
      if jsonb_typeof(r->k) is distinct from 'number' and jsonb_typeof(r->k) is distinct from 'null' then raise exception 'Invalid financial numeric type'; end if;
      if jsonb_typeof(r->k)='number' and abs((r->>k)::numeric)>1e18 then raise exception 'Financial number out of bounds'; end if;
    end loop;
    insert into public.fundamentals(stock_id,period_end,period_basis,eps_vnd,bvps_vnd,shares_outstanding,published_at,source,revenue_vnd,net_profit_vnd,parent_profit_vnd,roe,roa,roic,gross_margin,net_margin,debt_to_equity,operating_cash_flow_vnd,capex_vnd,free_cash_flow_vnd,dividends_paid_vnd,financial_payload,fetched_at)
    values(sid,(r->>'periodEnd')::date,'annual',(r->>'epsAnnualVnd')::numeric,(r->>'bvpsVnd')::numeric,(r->>'sharesOutstanding')::bigint,(r->>'publishedAt')::timestamptz,'KBS_VIETCAP',(r->>'revenueVnd')::numeric,(r->>'netProfitVnd')::numeric,(r->>'parentProfitVnd')::numeric,(r->>'roe')::numeric,(r->>'roa')::numeric,(r->>'roic')::numeric,(r->>'grossMargin')::numeric,(r->>'netMargin')::numeric,(r->>'debtToEquity')::numeric,(r->>'operatingCashFlowVnd')::numeric,(r->>'capexVnd')::numeric,(r->>'freeCashFlowVnd')::numeric,(r->>'dividendsPaidVnd')::numeric,r,stamp)
    on conflict(stock_id,period_end,period_basis) do update set eps_vnd=excluded.eps_vnd,bvps_vnd=excluded.bvps_vnd,shares_outstanding=excluded.shares_outstanding,published_at=excluded.published_at,source=excluded.source,revenue_vnd=excluded.revenue_vnd,net_profit_vnd=excluded.net_profit_vnd,parent_profit_vnd=excluded.parent_profit_vnd,roe=excluded.roe,roa=excluded.roa,roic=excluded.roic,gross_margin=excluded.gross_margin,net_margin=excluded.net_margin,debt_to_equity=excluded.debt_to_equity,operating_cash_flow_vnd=excluded.operating_cash_flow_vnd,capex_vnd=excluded.capex_vnd,free_cash_flow_vnd=excluded.free_cash_flow_vnd,dividends_paid_vnd=excluded.dividends_paid_vnd,financial_payload=excluded.financial_payload,fetched_at=excluded.fetched_at;
  end loop;
  insert into public.financial_snapshots(stock_id,source,fetched_at,payload) values(sid,'KBS_VIETCAP',stamp,dataset)
  on conflict(stock_id) do update set fetched_at=excluded.fetched_at,payload=excluded.payload;
end $$;
revoke all on function public.ingest_financials(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_financials(jsonb) to service_role;

create function public.keep_newer_score() returns trigger
language plpgsql set search_path = '' as $$
begin
 if old.computed_at > new.computed_at or old.inputs_as_of > new.inputs_as_of then return null; end if;
 return new;
end $$;
revoke all on function public.keep_newer_score() from public,anon,authenticated;
create trigger keep_newer_score before update on public.scores for each row execute function public.keep_newer_score();

commit;
