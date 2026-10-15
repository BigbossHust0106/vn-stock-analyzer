\set ON_ERROR_STOP on
begin;
insert into public.stocks(id,symbol,exchange,name) values('30000000-0000-4000-8000-000000000003','BKP','HOSE','Synthetic backup test');
set local role service_role;
insert into public.financial_report_backups(stock_id,source,fetched_at,payload)
select '30000000-0000-4000-8000-000000000003','VIETCAP_REPORTS',now(),jsonb_build_object('symbol','BKP','source','VIETCAP_REPORTS','verification','raw_provider_only','usableForScoring',false,'fetchedAt',now(),'reports',jsonb_build_object('BALANCE_SHEET','[{"year":2025,"fields":{"bsa1":100}}]'::jsonb,'INCOME_STATEMENT','[{"year":2025,"fields":{"isa23":4}}]'::jsonb,'CASH_FLOW','[{"year":2025,"fields":{"cfa1":20}}]'::jsonb));
do $$begin
 begin
 update public.financial_report_backups set payload=jsonb_set(payload,'{reports,INCOME_STATEMENT}','[]') where stock_id='30000000-0000-4000-8000-000000000003';
 raise exception 'Empty backup accepted';
 exception when raise_exception then if sqlerrm='Empty backup accepted' then raise;end if;end;
 begin
 update public.financial_report_backups set payload=jsonb_set(payload,'{reports,INCOME_STATEMENT,0,fields,isa23}','null') where stock_id='30000000-0000-4000-8000-000000000003';
 raise exception 'Field loss accepted';
 exception when raise_exception then if sqlerrm='Field loss accepted' then raise;end if;end;
 -- Refresh failed: retain the old data and expose error status separately.
 update public.financial_report_backups set last_error='Synthetic outage' where stock_id='30000000-0000-4000-8000-000000000003';
 if (select payload#>>'{reports,INCOME_STATEMENT,0,fields,isa23}' from public.financial_report_backups where stock_id='30000000-0000-4000-8000-000000000003') is distinct from '4' then raise exception 'Good backup lost';end if;
end $$;
set local role anon;
do $$begin
 if not exists(select 1 from public.financial_report_backups where stock_id='30000000-0000-4000-8000-000000000003' and payload->>'usableForScoring'='false') then raise exception 'Public backup read failed';end if;
 begin update public.financial_report_backups set last_error='anonymous corruption';raise exception 'Anonymous backup write';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
\echo FINANCIAL BACKUP PASS: service write, public read only, empty/field-loss rejected, outage preserves good data, never scoring input
