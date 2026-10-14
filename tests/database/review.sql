\set ON_ERROR_STOP on
begin;
do $$ begin
 if has_function_privilege('anon','public.persist_financial_score(jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.persist_financial_score(jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.reconcile_stock_catalog(jsonb,boolean,timestamptz)','execute') then raise exception 'Private RPC executable by public user'; end if;
end $$;
insert into public.stocks(id,symbol,exchange,name) values('20000000-0000-4000-8000-000000000011','TST','HOSE','Synthetic atomic regression test');
set local role service_role;
select public.ingest_current_quotes(jsonb_build_array(jsonb_build_object('symbol','TST','reference_vnd',10,'ceiling_vnd',12,'floor_vnd',9,'last_price_vnd',11,'bid3_price_vnd',10,'last_volume_raw',100,'lot_raw',100,'fetched_at',now()-interval '20 seconds')));
do $$ declare dataset jsonb; rowdata jsonb; q public.prices_current%rowtype; ver uuid; n jsonb; begin
 select * into q from public.prices_current where stock_id='20000000-0000-4000-8000-000000000011';
 dataset:=jsonb_build_object('symbol','TST','source','KBS_VIETCAP','verification','provider_reported','fetchedAt',now()-interval '10 seconds','annual','[{"year":2024,"periodEnd":"2024-12-31","publishedAt":"2025-03-01T00:00:00+07:00","audited":true,"consolidated":true,"revenueVnd":100,"netProfitVnd":20,"parentProfitVnd":18,"epsAnnualVnd":4,"bvpsVnd":25,"roe":0.2,"roa":0.1,"roic":0.2,"grossMargin":0.3,"netMargin":0.15,"debtToEquity":0.1,"operatingCashFlowVnd":100,"capexVnd":20,"freeCashFlowVnd":80,"dividendsPaidVnd":20,"sharesOutstanding":10}]'::jsonb);
 rowdata:=jsonb_build_object('stock_id',q.stock_id,'as_of',(now() at time zone 'Asia/Ho_Chi_Minh')::date,'horizon','month','model_version','review-atomic','value',80,'insufficient_reason',null,'inputs_as_of',dataset->'fetchedAt','computed_at',now(),'quote_version',q.version,'explanation',jsonb_build_object('asOf',now(),'quoteEvidence',jsonb_build_object('fetchedAt',q.fetched_at)));
 perform public.persist_financial_score(dataset,rowdata);
 select version into ver from public.financial_snapshots where stock_id=q.stock_id;
 if not exists(select 1 from public.scores where stock_id=q.stock_id and financial_version=ver and quote_version=q.version and financial_inputs=dataset and quote_inputs->>'version'=q.version::text) then raise exception 'Missing exact input versions'; end if;
 n:=jsonb_set(jsonb_set(dataset,'{fetchedAt}',to_jsonb(now()-interval '5 seconds')),'{annual,0,epsAnnualVnd}','5');
 begin
  perform public.persist_financial_score(n,jsonb_set(jsonb_set(rowdata,'{inputs_as_of}',n->'fetchedAt'),'{value}','101'));
  raise exception 'Score101 accepted';
 exception when check_violation then null; end;
 if(select payload from public.financial_snapshots where stock_id=q.stock_id)<>dataset or (select version from public.financial_snapshots where stock_id=q.stock_id)<>ver or (select eps_vnd from public.fundamentals where stock_id=q.stock_id)<>4 or (select value from public.scores where stock_id=q.stock_id)<>80 then raise exception 'Partial commit after score failure'; end if;
 begin
  perform public.persist_financial_score(n,jsonb_set(rowdata,'{quote_version}',to_jsonb(gen_random_uuid())));
  raise exception 'Mismatched quote accepted';
 exception when raise_exception then if sqlerrm='Mismatched quote accepted' then raise; end if; end;
 begin
  perform public.ingest_financials(jsonb_set(dataset,'{annual}','[]'));
  raise exception 'Empty replaced good financials';
 exception when raise_exception then if sqlerrm='Empty replaced good financials' then raise; end if; end;
 begin
  perform public.ingest_financials(jsonb_set(dataset,'{annual,0,roe}','null'));
  raise exception 'Ratio loss replaced good financials';
 exception when raise_exception then if sqlerrm='Ratio loss replaced good financials' then raise; end if; end;
 if(select payload from public.financial_snapshots where stock_id=q.stock_id)<>dataset then raise exception 'Good snapshot lost'; end if;
 update public.financial_snapshots set payload=payload||'{"documentEvidence":[{"year":2024}]}'::jsonb where stock_id=q.stock_id;
 begin
  update public.financial_snapshots set payload=payload-'documentEvidence' where stock_id=q.stock_id;
  raise exception 'Primary evidence erased';
 exception when raise_exception then if sqlerrm<>'Verified document evidence regression' then raise;end if;end;
 if not exists(select 1 from public.financial_snapshots where stock_id=q.stock_id and payload->'documentEvidence'='[{"year":2024}]'::jsonb) then raise exception 'Document evidence not preserved';end if;

end $$;
rollback;
\echo REVIEW SQL PASS: atomic rollback on score failure, exact input versions, stale quote rejected, empty/ratio regression preserves snapshot

begin;
set local role service_role;
do $$ declare rows jsonb; first_stamp timestamptz:=now()-interval '20 seconds'; new_stamp timestamptz:=now()-interval '10 seconds'; begin
 select jsonb_agg(jsonb_build_object('symbol','T'||lpad(i::text,3,'0'),'name','Synthetic catalog test','source','KBS','exchange',case when i<=50 then 'HOSE' when i<=100 then 'HNX' else 'UPCOM' end,'search_text','synthetic')) into rows from generate_series(1,150)i;
 perform public.reconcile_stock_catalog(rows,true,first_stamp);
 perform public.reconcile_stock_catalog(rows-0,true,new_stamp);
 if(select active from public.stocks where symbol='T001') then raise exception 'Missing symbol remains active'; end if;
 begin
  perform public.reconcile_stock_catalog(rows-1,false,now());
  raise exception 'Incomplete catalog accepted';
 exception when raise_exception then if sqlerrm='Incomplete catalog accepted' then raise; end if; end;
 begin
  perform public.reconcile_stock_catalog((select jsonb_agg(r) from jsonb_array_elements(rows)with ordinality a(r,i) where i<=110),true,now());
  raise exception 'Truncated catalog accepted';
 exception when raise_exception then if sqlerrm='Truncated catalog accepted' then raise; end if; end;
 if(select count(*) from public.stocks where source='KBS' and active)<>149 then raise exception 'Failed source deactivated catalog'; end if;
 perform public.reconcile_stock_catalog(rows,true,now());
 if not(select active from public.stocks where symbol='T001') then raise exception 'Returned symbol not reactivated'; end if;
end $$;
rollback;
\echo REVIEW SQL PASS: catalog reconciliation, missing inactive, returned active, incomplete/truncated refusal without mass deactivation
