begin;
create table public.agent_requests(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
create index agent_requests_owner_time on public.agent_requests(owner_id,created_at desc);
alter table public.agent_requests enable row level security;
revoke all on public.agent_requests from public,anon,authenticated;
create function public.claim_agent_request() returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();begin
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,161400));
 if (select count(*) from public.agent_requests where owner_id=uid and created_at>now()-interval '1 minute')>=3 or (select count(*) from public.agent_requests where owner_id=uid and created_at>now()-interval '1 hour')>=30 or (select count(*) from public.agent_requests where owner_id=uid and created_at>now()-interval '1 day')>=100 then return false;end if;
 delete from public.agent_requests where created_at<now()-interval '7 days';
 insert into public.agent_requests(owner_id)values(uid);return true;
end $$;
create table public.agent_proposals(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,action jsonb not null,summary text not null check(length(summary) between 1 and 2000),before_state jsonb not null,status text not null default 'pending' check(status in('pending','applied','cancelled')),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',result jsonb);
create index agent_proposals_owner on public.agent_proposals(owner_id,created_at desc);
alter table public.agent_proposals enable row level security;
alter table public.agent_proposals force row level security;
create policy own_agent_proposals on public.agent_proposals for select to authenticated using((select auth.uid())=owner_id);
revoke all on public.agent_proposals from public,anon,authenticated;
grant select on public.agent_proposals to authenticated;
-- Private helper. Definer callers always supply auth.uid(), never a body owner_id.
create function public.agent_action_state(uid uuid,a jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.watchlists;s public.stocks;i public.watchlist_items;r public.watchlist_alert_rules;v jsonb='{}';lid uuid=(a->>'listId')::uuid;sid uuid=(a->>'stockId')::uuid;
begin
 if a->>'type' is null or a->>'type' not in('create_list','rename_list','delete_list','add_stock','remove_stock','edit_item','create_alert','delete_alert','toggle_alert') or uid is null then raise exception 'INVALID_ACTION';end if;
 if a->>'type'='create_list' then
  if exists(select 1 from public.watchlists where owner_id=uid and name=a->>'name')then raise exception 'LIST_EXISTS';end if;
  return '{}';
 end if;
 if lid is null then raise exception 'LIST_REQUIRED';end if;
 select * into w from public.watchlists where id=lid and owner_id=uid;
 if not found then raise exception 'NOT_FOUND';end if;v=jsonb_build_object('list',to_jsonb(w));
 if a->>'type'='delete_list' then
  v=v||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x)order by stock_id),'[]') from public.watchlist_items x where watchlist_id=lid and owner_id=uid),'rules',(select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]') from public.watchlist_alert_rules x where watchlist_id=lid and owner_id=uid));
 end if;
 if a->>'type' in('add_stock','remove_stock','edit_item','create_alert','delete_alert','toggle_alert')then
  select * into s from public.stocks where id=sid and active;
  if not found then raise exception 'STOCK_NOT_FOUND';end if;
  v=v||jsonb_build_object('stock',jsonb_build_object('id',s.id,'symbol',s.symbol,'active',s.active));
  select * into i from public.watchlist_items where watchlist_id=lid and stock_id=sid and owner_id=uid;
  if not found and a->>'type'<>'add_stock' then raise exception 'ITEM_REQUIRED';end if;
  if found and a->>'type'='add_stock' then raise exception 'ITEM_EXISTS';end if;
  v=v||jsonb_build_object('item',to_jsonb(i));
  if a->>'type'='remove_stock' then v=v||jsonb_build_object('rules',(select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]') from public.watchlist_alert_rules x where watchlist_id=lid and stock_id=sid and owner_id=uid));end if;
 end if;
 if a->>'type' in('delete_alert','toggle_alert')then
  select * into r from public.watchlist_alert_rules where id=(a->>'alertId')::uuid and owner_id=uid and watchlist_id=lid and stock_id=sid;
  if not found then raise exception 'NOT_FOUND';end if;v=v||jsonb_build_object('rule',to_jsonb(r));
 end if;
 return v;
end $$;
revoke all on function public.agent_action_state(uuid,jsonb) from public,anon,authenticated;
create function public.prepare_agent_action(a jsonb,description text)returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();p public.agent_proposals;state jsonb;
begin
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>6000 or exists(select 1 from jsonb_object_keys(a)k where k not in('type','name','listId','stockId','notes','targetVnd','kind','lowerVnd','upperVnd','alertId','enabled'))then raise exception 'INVALID_ACTION';end if;
 if a->>'type' in('create_list','rename_list') and (jsonb_typeof(a->'name') is distinct from 'string' or length(trim(a->>'name')) not between 1 and 120)then raise exception 'INVALID_NAME';end if;
 if a->>'type'='edit_item' and (jsonb_typeof(a->'notes') is distinct from 'string' or length(a->>'notes')>2000 or (a->'targetVnd'<>'null'::jsonb and (jsonb_typeof(a->'targetVnd') is distinct from 'number' or (a->>'targetVnd')::numeric<=0 or (a->>'targetVnd')::numeric>=1e12)))then raise exception 'INVALID_ITEM';end if;
 if a->>'type'='toggle_alert' and jsonb_typeof(a->'enabled') is distinct from 'boolean'then raise exception 'INVALID_ALERT';end if;
 if a->>'type'='create_alert' and (a->>'kind' is null or a->>'kind' not in('buy_zone','sell_zone','stop_loss') or jsonb_typeof(a->'lowerVnd') is distinct from 'number' or (a->>'lowerVnd')::numeric<=0 or (a->>'lowerVnd')::numeric>=1e12 or case when a->>'kind'='buy_zone' then jsonb_typeof(a->'upperVnd') is distinct from 'number' or (a->>'upperVnd')::numeric<(a->>'lowerVnd')::numeric or (a->>'upperVnd')::numeric>=1e12 else a->'upperVnd' is distinct from 'null'::jsonb end)then raise exception 'INVALID_ALERT';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,161400));
 if (select count(*) from public.agent_proposals where owner_id=uid and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT';end if;
 state=public.agent_action_state(uid,a);
 insert into public.agent_proposals(owner_id,action,summary,before_state)values(uid,a,description,state)returning * into p;
 return jsonb_build_object('id',p.id,'summary',p.summary,'status',p.status,'expiresAt',p.expires_at);
end $$;
create function public.resolve_agent_action(proposal uuid,apply boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();p public.agent_proposals;a jsonb;lid uuid;sid uuid;rid uuid;result_id uuid;
begin
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,161400));
 select * into p from public.agent_proposals where id=proposal and owner_id=uid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p.status<>'pending' then return jsonb_build_object('status',p.status,'result',p.result);end if;
 if not apply then update public.agent_proposals set status='cancelled' where id=p.id;return jsonb_build_object('status','cancelled');end if;
 if now()>p.expires_at then raise exception 'EXPIRED';end if;
 a=p.action;lid=(a->>'listId')::uuid;sid=(a->>'stockId')::uuid;rid=(a->>'alertId')::uuid;
 -- Serialize against renames/deletes/edits already underway on the target object.
 perform 1 from public.watchlists where id=lid and owner_id=uid for update;
 perform 1 from public.watchlist_items where watchlist_id=lid and stock_id=sid and owner_id=uid for update;
 perform 1 from public.watchlist_alert_rules where id=rid and owner_id=uid for update;
 if public.agent_action_state(uid,a)<>p.before_state then raise exception 'STALE_PROPOSAL';end if;
 case a->>'type'
 when 'create_list' then insert into public.watchlists(owner_id,name)values(uid,a->>'name')returning id into result_id;
 when 'rename_list' then update public.watchlists set name=a->>'name' where id=lid and owner_id=uid;
 when 'delete_list' then delete from public.watchlists where id=lid and owner_id=uid;
 when 'add_stock' then insert into public.watchlist_items(owner_id,watchlist_id,stock_id)values(uid,lid,sid);
 when 'remove_stock' then delete from public.watchlist_items where watchlist_id=lid and stock_id=sid and owner_id=uid;
 when 'edit_item' then update public.watchlist_items set notes=a->>'notes',target_price_vnd=(a->>'targetVnd')::numeric,updated_at=now()where watchlist_id=lid and stock_id=sid and owner_id=uid;
 when 'create_alert' then insert into public.watchlist_alert_rules(owner_id,watchlist_id,stock_id,kind,lower_vnd,upper_vnd)values(uid,lid,sid,a->>'kind',(a->>'lowerVnd')::numeric,(a->>'upperVnd')::numeric)returning id into result_id;
 when 'delete_alert' then delete from public.watchlist_alert_rules where id=rid and owner_id=uid;
 when 'toggle_alert' then update public.watchlist_alert_rules set enabled=(a->>'enabled')::boolean where id=rid and owner_id=uid;
 else raise exception 'INVALID_ACTION';end case;
 update public.agent_proposals set status='applied',result=jsonb_build_object('id',result_id)where id=p.id;
 return jsonb_build_object('status','applied','result',jsonb_build_object('id',result_id));
end $$;
revoke all on function public.claim_agent_request(),public.prepare_agent_action(jsonb,text),public.resolve_agent_action(uuid,boolean) from public,anon;
grant execute on function public.claim_agent_request(),public.prepare_agent_action(jsonb,text),public.resolve_agent_action(uuid,boolean) to authenticated;
grant all on public.agent_proposals,public.agent_requests to service_role;
commit;
