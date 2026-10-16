begin;
-- Nguồn BCTC dự phòng FireAnt (+ EPS/ngày công bố Vietcap). Chỉ mở rộng giá trị
-- source; mọi kiểm tra kỳ năm, kiểm toán/hợp nhất, ngày công bố, kiểu số và chống
-- snapshot cũ/suy giảm giữ nguyên.
alter table public.financial_snapshots drop constraint financial_snapshots_source_check;
alter table public.financial_snapshots add constraint financial_snapshots_source_check
  check(source in ('KBS_VIETCAP','FIREANT_VIETCAP'));
create or replace function public.ingest_financials(dataset jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare sid uuid; r jsonb; k text; stamp timestamptz; oldstamp timestamptz;
begin
  if coalesce(dataset->>'source','') not in ('KBS_VIETCAP','FIREANT_VIETCAP') or dataset->>'verification' is distinct from 'provider_reported' or jsonb_typeof(dataset->'annual') is distinct from 'array' then raise exception 'Invalid financial source/payload'; end if;
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
    values(sid,(r->>'periodEnd')::date,'annual',(r->>'epsAnnualVnd')::numeric,(r->>'bvpsVnd')::numeric,(r->>'sharesOutstanding')::bigint,(r->>'publishedAt')::timestamptz,dataset->>'source',(r->>'revenueVnd')::numeric,(r->>'netProfitVnd')::numeric,(r->>'parentProfitVnd')::numeric,(r->>'roe')::numeric,(r->>'roa')::numeric,(r->>'roic')::numeric,(r->>'grossMargin')::numeric,(r->>'netMargin')::numeric,(r->>'debtToEquity')::numeric,(r->>'operatingCashFlowVnd')::numeric,(r->>'capexVnd')::numeric,(r->>'freeCashFlowVnd')::numeric,(r->>'dividendsPaidVnd')::numeric,r,stamp)
    on conflict(stock_id,period_end,period_basis) do update set eps_vnd=excluded.eps_vnd,bvps_vnd=excluded.bvps_vnd,shares_outstanding=excluded.shares_outstanding,published_at=excluded.published_at,source=excluded.source,revenue_vnd=excluded.revenue_vnd,net_profit_vnd=excluded.net_profit_vnd,parent_profit_vnd=excluded.parent_profit_vnd,roe=excluded.roe,roa=excluded.roa,roic=excluded.roic,gross_margin=excluded.gross_margin,net_margin=excluded.net_margin,debt_to_equity=excluded.debt_to_equity,operating_cash_flow_vnd=excluded.operating_cash_flow_vnd,capex_vnd=excluded.capex_vnd,free_cash_flow_vnd=excluded.free_cash_flow_vnd,dividends_paid_vnd=excluded.dividends_paid_vnd,financial_payload=excluded.financial_payload,fetched_at=excluded.fetched_at;
  end loop;
  insert into public.financial_snapshots(stock_id,source,fetched_at,payload) values(sid,dataset->>'source',stamp,dataset)
  on conflict(stock_id) do update set source=excluded.source,fetched_at=excluded.fetched_at,payload=excluded.payload;
end $$;
revoke all on function public.ingest_financials(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_financials(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
