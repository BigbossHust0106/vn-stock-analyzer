begin;
alter table public.watchlist_items add constraint watchlist_items_owner_item unique(owner_id,watchlist_id,stock_id);
create table public.watchlist_alert_rules (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 watchlist_id uuid not null, stock_id uuid not null,
 kind text not null check(kind in('buy_zone','sell_zone','stop_loss','score_change','important_news')),
 enabled boolean not null default true, email_enabled boolean not null default false,
 lower_vnd numeric(24,6), upper_vnd numeric(24,6), score_delta numeric not null default 10 check(score_delta between 1 and 100),
 horizon public.ranking_horizon not null default 'quarter', config_version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(owner_id,watchlist_id,stock_id) references public.watchlist_items(owner_id,watchlist_id,stock_id) on delete cascade,
 check(lower_vnd is null or (lower_vnd>0 and lower_vnd<1e12)),check(upper_vnd is null or (upper_vnd>0 and upper_vnd<1e12)),
 check(case when kind='buy_zone' then lower_vnd is not null and upper_vnd is not null and upper_vnd>=lower_vnd when kind in('sell_zone','stop_loss') then lower_vnd is not null and upper_vnd is null else lower_vnd is null and upper_vnd is null end),
 unique(owner_id,watchlist_id,stock_id,kind,horizon)
);
create index watchlist_alert_rules_active on public.watchlist_alert_rules(id) where enabled;
create table public.watchlist_alert_state(rule_id uuid primary key references public.watchlist_alert_rules(id) on delete cascade, revision integer not null default 0,snapshot jsonb not null default '{}');
create table public.notifications (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 rule_id uuid references public.watchlist_alert_rules(id) on delete set null, stock_id uuid not null references public.stocks(id),
 watchlist_id uuid, kind text not null check(kind in('buy_zone','sell_zone','stop_loss','score_change','important_news','test')),
 title text not null check(length(title) between 1 and 200), body text not null check(length(body) between 1 and 2000),
 source_url text check(source_url ~ '^https://(cafef\.vn|vietstock\.vn|vneconomy\.vn|vnexpress\.net)/'),
 evidence jsonb not null default '{}', event_key text not null check(length(event_key) between 1 and 200),
 created_at timestamptz not null default now(),read_at timestamptz,
 foreign key(owner_id,watchlist_id) references public.watchlists(owner_id,id) on delete cascade,
 unique(rule_id,event_key)
);
create index notifications_owner_time on public.notifications(owner_id,created_at desc);
create index notifications_owner_unread on public.notifications(owner_id) where read_at is null;
create table public.alert_email_outbox (
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 state text not null default 'pending' check(state in('pending','sending','sent','failed','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3), next_attempt_at timestamptz not null default now(),
 lease_until timestamptz, provider_id text, code text, updated_at timestamptz not null default now()
);
create index alert_email_ready on public.alert_email_outbox(next_attempt_at) where state in('pending','sending');
-- Worker evaluates with service role; no client can forge a real notification or state.
alter table public.watchlist_alert_rules enable row level security;
alter table public.watchlist_alert_state enable row level security;
alter table public.notifications enable row level security;
alter table public.alert_email_outbox enable row level security;
create policy own_rules on public.watchlist_alert_rules for all to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy own_alert_state on public.watchlist_alert_state for select to authenticated using(exists(select 1 from public.watchlist_alert_rules r where r.id=rule_id and r.owner_id=(select auth.uid())));
create policy own_notifications_read on public.notifications for select to authenticated using((select auth.uid())=owner_id);
create policy own_notifications_read_at on public.notifications for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy own_notifications_delete on public.notifications for delete to authenticated using((select auth.uid())=owner_id);
revoke all on public.watchlist_alert_rules,public.watchlist_alert_state,public.notifications,public.alert_email_outbox from anon,authenticated;
grant select,insert,update,delete on public.watchlist_alert_rules to authenticated;
grant select,delete on public.notifications to authenticated;
grant select on public.watchlist_alert_state to authenticated;
grant update(read_at) on public.notifications to authenticated;
grant all on public.watchlist_alert_rules,public.watchlist_alert_state,public.notifications,public.alert_email_outbox to service_role;
create function public.alert_rule_version() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if TG_OP='INSERT' then new.config_version=1;new.created_at=now(); else new.config_version=old.config_version+1;end if;
 new.updated_at=now();return new;end $$;
revoke all on function public.alert_rule_version() from public,anon,authenticated;
create trigger alert_rule_version before insert or update on public.watchlist_alert_rules for each row execute function public.alert_rule_version();
create function public.record_watchlist_alert(rule uuid, config integer, expected_revision integer, snapshot jsonb, events jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare r public.watchlist_alert_rules; v integer; e jsonb; nid uuid; n integer=0;
begin
 if jsonb_typeof(snapshot) is distinct from 'object' or jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>10 then raise exception 'Invalid alert batch';end if;
 select * into r from public.watchlist_alert_rules where id=rule for update;
 if not found or not r.enabled or r.config_version<>config then return 0;end if;
 select revision into v from public.watchlist_alert_state where rule_id=rule;
 if coalesce(v,0)<>expected_revision then return 0;end if;
 -- A config version change resets its baseline without racing an older evaluator.
 insert into public.watchlist_alert_state values(rule,expected_revision+1,snapshot) on conflict(rule_id) do update set revision=excluded.revision,snapshot=excluded.snapshot;
 for e in select value from jsonb_array_elements(events) loop
  insert into public.notifications(owner_id,rule_id,stock_id,watchlist_id,kind,title,body,source_url,evidence,event_key)
  values(r.owner_id,r.id,r.stock_id,r.watchlist_id,r.kind,e->>'title',e->>'body',e->>'source_url',coalesce(e->'evidence','{}'),e->>'key') on conflict(rule_id,event_key) do nothing returning id into nid;
  if nid is not null then
   n=n+1;
   if r.email_enabled and exists(select 1 from public.user_settings where owner_id=r.owner_id and email_alerts) then insert into public.alert_email_outbox(notification_id) values(nid);end if;
  end if;
 end loop;return n;
end $$;
create function public.record_watchlist_alert_batch(rows jsonb) returns integer language plpgsql security invoker set search_path='' as $$ declare r jsonb;n integer=0;begin
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>100 then raise exception 'Invalid alert page';end if;
 for r in select value from jsonb_array_elements(rows) loop n=n+public.record_watchlist_alert((r->>'rule')::uuid,(r->>'config')::integer,(r->>'expected_revision')::integer,r->'snapshot',r->'events');end loop;return n;end $$;
revoke all on function public.record_watchlist_alert_batch(jsonb) from public,anon,authenticated;
grant execute on function public.record_watchlist_alert_batch(jsonb) to service_role;
create function public.create_test_alert(owner uuid,list uuid,stock uuid,send_email boolean default false) returns uuid language plpgsql security invoker set search_path='' as $$ declare nid uuid; begin
 if not exists(select 1 from public.watchlist_items where owner_id=owner and watchlist_id=list and stock_id=stock) then raise exception 'ALERT_WATCHLIST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,7107));
 if exists(select 1 from public.notifications where owner_id=owner and kind='test' and created_at>now()-interval '1 minute') then raise exception 'ALERT_TEST_RATE_LIMIT';end if;
 insert into public.notifications(owner_id,watchlist_id,stock_id,kind,title,body,event_key,evidence) values(owner,list,stock,'test','Cảnh báo thử','Thông báo thử đã được lưu cho tài khoản của bạn. Đây không phải tín hiệu giao dịch.',gen_random_uuid()::text,'{"test":true}') returning id into nid;
 if send_email and exists(select 1 from public.user_settings where owner_id=owner and email_alerts) then insert into public.alert_email_outbox(notification_id) values(nid);end if;
 return nid;end $$;
create function public.claim_alert_emails() returns setof public.alert_email_outbox language sql security invoker set search_path='' as $$
 with exhausted as(update public.alert_email_outbox set state='failed',code='EMAIL_ATTEMPTS_EXHAUSTED',updated_at=now() where state='sending' and lease_until<now() and attempts>=3 returning notification_id), picked as(select notification_id from public.alert_email_outbox where attempts<3 and next_attempt_at<=now() and (state='pending' or (state='sending' and lease_until<now())) order by next_attempt_at for update skip locked limit 5)
 update public.alert_email_outbox o set state='sending',attempts=o.attempts+1,lease_until=now()+interval '5 minutes',updated_at=now() from picked p where o.notification_id=p.notification_id returning o.*;
$$;
revoke all on function public.record_watchlist_alert(uuid,integer,integer,jsonb,jsonb),public.create_test_alert(uuid,uuid,uuid,boolean),public.claim_alert_emails() from public,anon,authenticated;
grant execute on function public.record_watchlist_alert(uuid,integer,integer,jsonb,jsonb),public.create_test_alert(uuid,uuid,uuid,boolean),public.claim_alert_emails() to service_role;
create table public.system_job_runs (
 id uuid primary key default gen_random_uuid(),job text not null check(job in('prices','closing','market','news','rankings','alerts','email','vps','ingest')),
 scheduled_at timestamptz not null, started_at timestamptz not null default now(),finished_at timestamptz,
 lease_until timestamptz not null default now()+interval '10 minutes',generation integer not null default 1,
 attempts integer not null default 0 check(attempts between 0 and 2),
 state text not null default 'running' check(state in('running','ok','skipped','degraded','failed')),
 code text check(code in('JOB_FAILED','SESSION_CLOSED','CALENDAR_MISSING','PARTIAL_SYNC','NEWS_LLM_UNCONFIGURED','EMAIL_UNCONFIGURED','NO_DATA','SOURCE_UNAVAILABLE')),
 unique(job,scheduled_at)
);
create index system_job_recent on public.system_job_runs(started_at desc);
create table public.api_health (
 provider text primary key check(provider='VPS'), state text not null check(state in('ok','degraded')),
 checked_at timestamptz not null,last_success_at timestamptz,latency_ms integer check(latency_ms>=0),code text check(code in('SOURCE_UNAVAILABLE'))
);
alter table public.system_job_runs enable row level security;
alter table public.api_health enable row level security;
create policy system_job_read on public.system_job_runs for select to anon,authenticated using(true);
create policy api_health_read on public.api_health for select to anon,authenticated using(true);
revoke all on public.system_job_runs,public.api_health from anon,authenticated;
grant select on public.system_job_runs,public.api_health to anon,authenticated;
grant all on public.system_job_runs,public.api_health to service_role;
create function public.claim_system_job(task text,stamp timestamptz) returns setof public.system_job_runs language sql security invoker set search_path='' as $$
 insert into public.system_job_runs(job,scheduled_at) values(task,stamp)
 on conflict(job,scheduled_at) do update set state='running',started_at=now(),finished_at=null,lease_until=now()+interval '10 minutes',generation=public.system_job_runs.generation+1,attempts=0,code=null
 where public.system_job_runs.state='running' and public.system_job_runs.lease_until<now()
 returning *;
$$;
revoke all on function public.claim_system_job(text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_system_job(text,timestamptz) to service_role;
create function public.system_data_freshness() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('prices',(select max(fetched_at) from public.prices_current),'scores',(select max(computed_at) from public.scores),'news',(select max(fetched_at) from public.news_feed_articles),'newsPublished',(select max(published_at) from public.news_feed_articles),'newsAnalyzed',(select max(analyzed_at) from public.news_feed_articles));
$$;
revoke all on function public.system_data_freshness() from public;
grant execute on function public.system_data_freshness() to anon,authenticated,service_role;
commit;
