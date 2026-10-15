\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('71000000-0000-0000-0000-000000000001'),('71000000-0000-0000-0000-000000000002');
insert into public.stocks(id,symbol,name,exchange,active,source,search_text) values('71000000-0000-0000-0000-000000000003','ZTA','Alert SQL Fixture','HOSE',true,'fixture','zta');
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
insert into public.watchlists(id,name) values('71000000-0000-0000-0000-000000000004','alerts owner A');
insert into public.watchlist_items(watchlist_id,stock_id) values('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003');
insert into public.watchlist_alert_rules(id,watchlist_id,stock_id,kind,lower_vnd,upper_vnd) values('71000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003','buy_zone',10000,11000);
insert into public.watchlist_alert_rules(watchlist_id,stock_id,kind,lower_vnd) values('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003','sell_zone',15000),('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003','sell_zone',18000);
do $$ begin
 begin insert into public.watchlist_alert_rules(watchlist_id,stock_id,kind,lower_vnd,upper_vnd) values('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003','buy_zone',11000,10000);raise exception 'Invalid zone accepted';exception when check_violation then null;end;
 begin perform public.create_test_alert('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003');raise exception 'Client can forge server notifications';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
do $$ begin
 if exists(select 1 from public.watchlist_alert_rules) then raise exception 'B reads A rules';end if;
 begin insert into public.watchlist_alert_rules(watchlist_id,stock_id,kind,lower_vnd) values('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003','sell_zone',15000);raise exception 'B writes rule for A item';exception when foreign_key_violation then null;end;
end $$;
set local role service_role;
select public.record_watchlist_alert('71000000-0000-0000-0000-000000000005',1,0,'{"config":1}', '[{"key":"sample-quote","title":"Fixture alert","body":"SQL fixture only, not market advice","evidence":{}}]');
-- Same baseline raced by a second evaluator: no second notification or revision write.
select public.record_watchlist_alert('71000000-0000-0000-0000-000000000005',1,0,'{"config":1}', '[{"key":"different-race","title":"Race","body":"Should not be written"}]');
select public.record_watchlist_alert('71000000-0000-0000-0000-000000000005',1,1,'{"config":1}', '[{"key":"sample-quote","title":"Duplicate","body":"Must be deduped"}]');
do $$ begin if (select count(*) from public.notifications where rule_id='71000000-0000-0000-0000-000000000005')<>1 then raise exception 'Alert race/idempotency failed';end if;end $$;
select public.create_test_alert('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003');
do $$ begin
 begin perform public.create_test_alert('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003');raise exception 'Test rate limit missing';exception when raise_exception then if sqlerrm<>'ALERT_TEST_RATE_LIMIT' then raise;end if;end;
 if (select count(*) from public.claim_system_job('alerts',now()))<>1 then raise exception 'Job not claimed';end if;
 if (select count(*) from public.claim_system_job('alerts',now()))<>0 then raise exception 'Concurrent job claimed';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
do $$ begin if exists(select 1 from public.notifications) or exists(select 1 from public.watchlist_alert_state) then raise exception 'B reads A notifications/state';end if;end $$;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
do $$ begin
 if (select count(*) from public.notifications)<>2 then raise exception 'A cannot receive own notifications';end if;
 begin update public.notifications set title='forged';raise exception 'Client rewrote message';exception when insufficient_privilege then null;end;
 begin select * from public.alert_email_outbox;raise exception 'Client reads outbox';exception when insufficient_privilege then null;end;
 begin update public.system_job_runs set state='ok';raise exception 'Client forged health';exception when insufficient_privilege then null;end;
end $$;
update public.notifications set read_at=now();
update public.watchlist_alert_rules set enabled=false where id='71000000-0000-0000-0000-000000000005';
set local role service_role;
do $$ begin
 if (select config_version from public.watchlist_alert_rules where id='71000000-0000-0000-0000-000000000005')<>2 then raise exception 'Rule version failed';end if;
 if public.record_watchlist_alert('71000000-0000-0000-0000-000000000005',1,2,'{}','[]')<>0 then raise exception 'Old config accepted';end if;
end $$;
set local role anon;
do $$ begin
 if (select count(*) from public.system_job_runs)<>1 then raise exception 'Safe system status unreadable';end if;
 begin select * from public.notifications;raise exception 'Anon reads private alerts';exception when insufficient_privilege then null;end;
 begin perform public.claim_system_job('alerts',now());raise exception 'Anon starts jobs';exception when insufficient_privilege then null;end;
end $$;
rollback;
\echo 'ALERTS DB PASS: A/B isolation; no forged notification/status; watchlist ownership; CAS and event dedupe; test rate limit; job lease; own read state'
