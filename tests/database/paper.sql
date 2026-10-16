\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('91000000-0000-0000-0000-000000000001'),('91000000-0000-0000-0000-000000000002');
insert into public.stocks(id,symbol,name,exchange,source,search_text) values('91000000-0000-0000-0000-000000000003','ZP1','Paper SQL fixture','HOSE','fixture','zp1');
set local role service_role;
do $$ declare w jsonb;q jsonb;receipt jsonb;again jsonb;before_cash numeric;req uuid:='91000000-0000-0000-0000-000000000004';wid uuid;begin
 w:=public.paper_create_wallet('91000000-0000-0000-0000-000000000001','Ví SQL',100000000,15,10,req);wid:=(w->>'id')::uuid;
 perform set_config('paper.wallet',wid::text,true);
 if w->>'cash_vnd'<>'100000000' then raise exception 'Initial capital wrong';end if;
 if public.paper_create_wallet('91000000-0000-0000-0000-000000000001','Ví SQL',100000000,15,10,req)->>'id'<>w->>'id' then raise exception 'Wallet replay duplicated';end if;
 q:=public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',30000,now(),'source');
 receipt:=public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'buy',200,'91000000-0000-0000-0000-000000000005');
 again:=public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'buy',200,'91000000-0000-0000-0000-000000000005');
 if again->>'id'<>receipt->>'id' then raise exception 'Order replay duplicated';end if;
 -- Hand: 200*30,000=6,000,000; fee 0.15%=9,000; cash=93,991,000.
 if (select cash_vnd from public.paper_wallets where id=wid)<>93991000 or (select quantity from public.paper_positions where wallet_id=wid)<>200 then raise exception 'Buy accounting wrong';end if;
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'buy',200,gen_random_uuid());raise exception 'Quote reused';exception when raise_exception then if sqlerrm<>'PAPER_QUOTE_USED' then raise;end if;end;
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'sell',100,'91000000-0000-0000-0000-000000000005');raise exception 'Changed request accepted';exception when raise_exception then if sqlerrm<>'PAPER_REQUEST_REUSED' then raise;end if;end;
 q:=public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',33000,now(),'source');
 receipt:=public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'sell',100,gen_random_uuid());
 -- Hand: gross=3,300,000; fee=4,950; tax=3,300; cost allocated=3,004,500; realized=287,250.
 if (receipt->>'realized_vnd')::numeric<>287250 or (select cash_vnd from public.paper_wallets where id=wid)<>97282750 or (select cost_vnd from public.paper_positions where wallet_id=wid)<>3004500 then raise exception 'Partial sell accounting wrong';end if;
 q:=public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',33000,now(),'source');
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'sell',200,gen_random_uuid());raise exception 'Short selling allowed';exception when raise_exception then if sqlerrm<>'PAPER_INSUFFICIENT_SHARES' then raise;end if;end;
 before_cash:=(select cash_vnd from public.paper_wallets where id=wid);
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'buy',1000000,gen_random_uuid());raise exception 'Overdraft allowed';exception when raise_exception then if sqlerrm<>'PAPER_INSUFFICIENT_CASH' then raise;end if;end;
 if (select cash_vnd from public.paper_wallets where id=wid)<>before_cash or exists(select 1 from public.paper_quotes where id=(q->>'id')::uuid and used_at is not null) then raise exception 'Rejected order changed balances';end if;
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'buy',150,gen_random_uuid());raise exception 'Odd lot allowed';exception when raise_exception then if sqlerrm<>'PAPER_INVALID' then raise;end if;end;
 begin perform public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',33010,now(),'source');raise exception 'Wrong tick allowed';exception when raise_exception then if sqlerrm<>'PAPER_TICK' then raise;end if;end;
 begin perform public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',33000,now()+interval '1 hour','source');raise exception 'Future quote allowed';exception when raise_exception then if sqlerrm<>'PAPER_NO_PRICE' then raise;end if;end;
 begin perform public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',33000,now()-interval '15 days','cached');raise exception 'Old snapshot allowed';exception when raise_exception then if sqlerrm<>'PAPER_OLD_PRICE' then raise;end if;end;
 q:=public.paper_create_quote('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',33000,now()-interval '1 day','cached');
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',wid,(q->>'id')::uuid,'buy',100,gen_random_uuid(),false);raise exception 'Unacknowledged cached fill';exception when raise_exception then if sqlerrm<>'PAPER_ACCEPT_CACHED' then raise;end if;end;
 perform set_config('paper.expire_quote',q->>'id',true);
end $$;
reset role;
update public.paper_quotes set expires_at=now()-interval '1 second' where id=current_setting('paper.expire_quote')::uuid;
set local role service_role;
do $$begin
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',current_setting('paper.wallet')::uuid,current_setting('paper.expire_quote')::uuid,'buy',100,gen_random_uuid(),true);raise exception 'Expired quote filled';exception when raise_exception then if sqlerrm<>'PAPER_QUOTE_EXPIRED' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
do $$declare state jsonb;begin
 state:=public.paper_snapshot(current_setting('paper.wallet')::uuid);
 if jsonb_array_length(state->'trades')<>2 or (state#>>'{positions,0,quantity}')::integer<>100 or (state#>>'{positions,0,mark,price_vnd}')::numeric<>33000 then raise exception 'Own snapshot mismatch: %',state;end if;
 begin update public.paper_wallets set cash_vnd=1000000000;raise exception 'Client mints cash';exception when insufficient_privilege then null;end;
 begin insert into public.paper_quotes(owner_id,stock_id,symbol,price_vnd,observed_at,mode) values('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003','ZP1',1,now(),'source');raise exception 'Client sets fill price';exception when insufficient_privilege then null;end;
 begin perform public.paper_create_wallet('91000000-0000-0000-0000-000000000001','forged',1000000,0,0,gen_random_uuid());raise exception 'Client calls mint RPC';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
do $$begin
 if exists(select 1 from public.paper_wallets) or exists(select 1 from public.paper_quotes) or exists(select 1 from public.paper_positions) or exists(select 1 from public.paper_trades) then raise exception 'B reads A financial simulation';end if;
 begin perform public.paper_snapshot(current_setting('paper.wallet')::uuid);raise exception 'B loads A wallet';exception when raise_exception then if sqlerrm<>'PAPER_WALLET_MISSING' then raise;end if;end;
 begin perform public.paper_execute_order('91000000-0000-0000-0000-000000000001',current_setting('paper.wallet')::uuid,current_setting('paper.expire_quote')::uuid,'sell',100,gen_random_uuid(),true);raise exception 'B calls server fill';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$begin
 begin perform public.paper_snapshot();raise exception 'Anonymous reads wallet';exception when insufficient_privilege then null;end;
 begin select * from public.paper_wallets;raise exception 'Anonymous reads table';exception when insufficient_privilege then null;end;
end $$;
rollback;
\echo 'PAPER DB PASS: exact cash/cost/fees/tax/realized; partial sell; idempotency; quote expiry; stale consent; no overdraft/short/odd lot; read-only A/B RLS'
