\set ON_ERROR_STOP on
begin;
insert into public.stocks(id,symbol,exchange,name) values('20000000-0000-4000-8000-000000000010','TST','HOSE','Synthetic financial test, not source data');
set local role service_role;
select public.ingest_financials('{"symbol":"TST","source":"KBS_VIETCAP","verification":"provider_reported","fetchedAt":"2026-01-01T00:00:00Z","annual":[{"year":2024,"periodEnd":"2024-12-31","publishedAt":"2025-03-01T00:00:00+07:00","audited":true,"consolidated":true,"revenueVnd":100,"netProfitVnd":20,"parentProfitVnd":18,"epsAnnualVnd":4,"bvpsVnd":25,"roe":0.2,"roa":0.1,"roic":0.2,"grossMargin":0.3,"netMargin":0.15,"debtToEquity":0.1,"operatingCashFlowVnd":100,"capexVnd":20,"freeCashFlowVnd":80,"dividendsPaidVnd":20,"sharesOutstanding":10}]}');
do $$ declare payload jsonb; begin
 if (select eps_vnd from public.fundamentals where period_basis='annual')<>4 or (select free_cash_flow_vnd from public.fundamentals where period_basis='annual')<>80 then raise exception 'EPS or FCF stored with wrong unit'; end if;
 if exists(select 1 from public.fundamentals where fcfe_vnd is not null) then raise exception 'FCF incorrectly called FCFE'; end if;
 select s.payload into payload from public.financial_snapshots s;
 perform public.ingest_financials(jsonb_set(jsonb_set(payload,'{fetchedAt}','"2025-12-01T00:00:00Z"'),'{annual,0,epsAnnualVnd}','999'));
 if (select eps_vnd from public.fundamentals)<>4 then raise exception 'Stale payload overwrote newer'; end if;
 begin
 perform public.ingest_financials(jsonb_set(payload,'{annual,0,epsAnnualVnd}','"4"'));
 raise exception 'String EPS accepted';
 exception when raise_exception then if sqlerrm='String EPS accepted' then raise; end if; end;
 begin
 perform public.ingest_financials(jsonb_set(payload,'{annual,0,publishedAt}','"2027-01-01T00:00:00Z"'));
 raise exception 'Future publication accepted';
 exception when raise_exception then if sqlerrm='Future publication accepted' then raise; end if; end;
end $$;
rollback;
\echo FINANCIAL SQL PASS: EPS VND, FCF separate from FCFE, stale protection, malformed/future publication denied

begin;
insert into public.stocks(id,symbol,exchange,name) values('20000000-0000-4000-8000-000000000010','TST','HOSE','Synthetic scores');
set local role service_role;
insert into public.scores(stock_id,as_of,horizon,model_version,value,inputs_as_of,computed_at) values('20000000-0000-4000-8000-000000000010','2026-01-01','month','test',50,'2026-01-01T00:00:00Z','2026-01-01T02:00:00Z');
update public.scores set value=99,computed_at='2026-01-01T01:00:00Z';
do $$ begin
 if(select value from public.scores)<>50 then raise exception 'Older computation overwrote score'; end if;
end $$;
rollback;
\echo FINANCIAL SQL PASS: older score computation cannot overwrite newer score
