\set ON_ERROR_STOP on
begin;
insert into auth.users(id)values('97000000-0000-0000-0000-000000000001'),('97000000-0000-0000-0000-000000000002');
insert into public.stocks(id,symbol,name,exchange,active,source,search_text)values('97000000-0000-0000-0000-000000000003','ZAI','Agent SQL Fixture','HOSE',true,'fixture','zai');
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
select set_config('test.agent_proposal',(public.prepare_agent_action('{"type":"create_list","name":"Agent A"}','Tạo Agent A')->>'id'),true);
do $$begin
 if exists(select 1 from public.watchlists where name='Agent A')then raise exception 'Preview mutated data';end if;
 begin perform public.agent_action_state(auth.uid(),'{}');raise exception 'Helper exposed';exception when insufficient_privilege then null;end;
 begin insert into public.agent_proposals(owner_id,action,summary,before_state)values(auth.uid(),'{}','forged','{}');raise exception 'Client forged proposal';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
do $$begin
 if exists(select 1 from public.agent_proposals)then raise exception 'B reads A proposal';end if;
 begin perform public.resolve_agent_action(current_setting('test.agent_proposal')::uuid,true);raise exception 'B confirmed A proposal';exception when raise_exception then if sqlerrm<>'NOT_FOUND'then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
select public.resolve_agent_action(current_setting('test.agent_proposal')::uuid,true);
select public.resolve_agent_action(current_setting('test.agent_proposal')::uuid,true);
select set_config('test.agent_list',(select id::text from public.watchlists where name='Agent A'),true);
do $$declare p jsonb;lid text=current_setting('test.agent_list');sid text='97000000-0000-0000-0000-000000000003';rid uuid;begin
 if(select count(*)from public.watchlists where name='Agent A')<>1 then raise exception 'Duplicate apply';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','add_stock','listId',lid,'stockId',sid),'Thêm ZAI');
 if exists(select 1 from public.watchlist_items where watchlist_id=lid::uuid)then raise exception 'Preview added item';end if;
 perform public.resolve_agent_action((p->>'id')::uuid,true);perform public.resolve_agent_action((p->>'id')::uuid,true);
 if(select count(*)from public.watchlist_items where watchlist_id=lid::uuid)<>1 then raise exception 'Duplicate item';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','edit_item','listId',lid,'stockId',sid,'notes','Theo dõi','targetVnd',15000),'Sửa mục tiêu15000 VND');
 perform public.resolve_agent_action((p->>'id')::uuid,true);
 if(select target_price_vnd from public.watchlist_items where watchlist_id=lid::uuid)<>15000 then raise exception 'Target value wrong';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','edit_item','listId',lid,'stockId',sid,'notes','AI','targetVnd',16000),'Sửa16000');
 update public.watchlist_items set notes='Đã sửa nơi khác' where watchlist_id=lid::uuid;
 begin perform public.resolve_agent_action((p->>'id')::uuid,true);raise exception 'Stale preview applied';exception when raise_exception then if sqlerrm<>'STALE_PROPOSAL'then raise;end if;end;
 perform public.resolve_agent_action((p->>'id')::uuid,false);
 if(select target_price_vnd from public.watchlist_items where watchlist_id=lid::uuid)<>15000 then raise exception 'Stale preview mutated target';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','create_alert','listId',lid,'stockId',sid,'kind','stop_loss','lowerVnd',10000,'upperVnd',null),'Cắt lỗ10000 VND');
 if exists(select 1 from public.watchlist_alert_rules where watchlist_id=lid::uuid)then raise exception 'Preview created alert';end if;
 perform public.resolve_agent_action((p->>'id')::uuid,true);
 select id into rid from public.watchlist_alert_rules where watchlist_id=lid::uuid;
 p=public.prepare_agent_action(jsonb_build_object('type','toggle_alert','listId',lid,'stockId',sid,'alertId',rid,'enabled',false),'Tắt cảnh báo');perform public.resolve_agent_action((p->>'id')::uuid,true);
 if(select enabled from public.watchlist_alert_rules where id=rid)then raise exception 'Alert not disabled';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','delete_alert','listId',lid,'stockId',sid,'alertId',rid),'Xóa cảnh báo');perform public.resolve_agent_action((p->>'id')::uuid,true);
 if exists(select 1 from public.watchlist_alert_rules where id=rid)then raise exception 'Alert not deleted';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','remove_stock','listId',lid,'stockId',sid),'Xóa mã');perform public.resolve_agent_action((p->>'id')::uuid,false);
 if not exists(select 1 from public.watchlist_items where watchlist_id=lid::uuid)then raise exception 'Cancelled removal applied';end if;
 p=public.prepare_agent_action(jsonb_build_object('type','rename_list','listId',lid,'name','Agent renamed'),'Đổi tên');perform public.resolve_agent_action((p->>'id')::uuid,true);
 p=public.prepare_agent_action(jsonb_build_object('type','delete_list','listId',lid),'Xóa toàn bộ danh sách');perform public.resolve_agent_action((p->>'id')::uuid,true);
 if exists(select 1 from public.watchlists where id=lid::uuid)or exists(select 1 from public.watchlist_items where watchlist_id=lid::uuid)then raise exception 'Cascade delete failed';end if;
 if not public.claim_agent_request()or not public.claim_agent_request()or not public.claim_agent_request()or public.claim_agent_request()then raise exception 'Quota3/min broken';end if;
end $$;
select set_config('test.expired',(public.prepare_agent_action('{"type":"create_list","name":"Never apply"}','Hết hạn')->>'id'),true);
set local role service_role;
update public.agent_proposals set expires_at=now()-interval '1 second'where id=current_setting('test.expired')::uuid;
set local role authenticated;
do $$begin
 begin perform public.resolve_agent_action(current_setting('test.expired')::uuid,true);raise exception 'Expired action applied';exception when raise_exception then if sqlerrm<>'EXPIRED'then raise;end if;end;
 if exists(select 1 from public.watchlists where name='Never apply')then raise exception 'Expired list exists';end if;
end $$;
set local role anon;
do $$begin
 begin perform public.claim_agent_request();raise exception 'Anon calls agent';exception when insufficient_privilege then null;end;
 begin select * from public.agent_proposals;raise exception 'Anon reads proposals';exception when insufficient_privilege then null;end;
end $$;
rollback;
\echo 'AGENT DB PASS: preview-only, A/B isolation, immutable actions, confirmation/idempotency, stale/expired/cancelled protection, watchlist+alert operations, quota3/min'
