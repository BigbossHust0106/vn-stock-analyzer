begin;

-- Versions identify ingested observations, not a verified exchange timestamp or audit revision.
alter table public.prices_current add column version uuid not null default gen_random_uuid();
alter table public.financial_snapshots add column version uuid not null default gen_random_uuid();
alter table public.scores add column financial_version uuid, add column quote_version uuid,
  add column financial_inputs jsonb, add column quote_inputs jsonb;

create function public.financial_regression(old_payload jsonb,new_payload jsonb) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_array_length(old_payload->'annual'),0)>0 and (
   coalesce(jsonb_array_length(new_payload->'annual'),0)=0
   or (select max((r->>'year')::integer) from jsonb_array_elements(old_payload->'annual') r) >
      (select max((r->>'year')::integer) from jsonb_array_elements(new_payload->'annual') r)
   or exists(select 1 from jsonb_array_elements(old_payload->'annual') o
      join jsonb_array_elements(new_payload->'annual') n on o->>'year'=n->>'year'
      cross join lateral jsonb_each(o) f
      where jsonb_typeof(f.value)='number' and f.key not in ('year')
        and jsonb_typeof(n->f.key) is distinct from 'number')
 )
$$;
revoke all on function public.financial_regression(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.financial_regression(jsonb,jsonb) to service_role;
create function public.version_quote() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' then new.version:=gen_random_uuid(); end if;
  return new;
end $$;
create trigger version_quote before update on public.prices_current for each row execute function public.version_quote();
create function public.protect_financial_snapshot() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(jsonb_array_length(new.payload->'annual'),0)=0 then raise exception 'Empty financial snapshot refused'; end if;
  if tg_op='UPDATE' then
    if public.financial_regression(old.payload,new.payload) then raise exception 'Financial regression refused'; end if;
    if old.payload is distinct from new.payload then new.version:=gen_random_uuid(); else new.version:=old.version; end if;
  end if;
  return new;
end $$;
create trigger protect_financial_snapshot before insert or update on public.financial_snapshots for each row execute function public.protect_financial_snapshot();
revoke all on function public.version_quote(),public.protect_financial_snapshot() from public,anon,authenticated;

create function public.persist_financial_score(dataset jsonb,score_record jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare sid uuid; q public.prices_current%rowtype; f public.financial_snapshots%rowtype; computed timestamptz;
begin
  select id into strict sid from public.stocks where symbol=dataset->>'symbol' and active;
  perform 1 from public.stocks where id=sid for update;
  if (score_record->>'stock_id')::uuid is distinct from sid then raise exception 'Score stock mismatch'; end if;
  select * into q from public.prices_current where stock_id=sid for update;
  if q.version is distinct from (score_record->>'quote_version')::uuid then raise exception 'Quote version changed; recompute'; end if;
  if (score_record->>'inputs_as_of')::timestamptz is distinct from (dataset->>'fetchedAt')::timestamptz then raise exception 'Financial input mismatch'; end if;
  computed:=(score_record->>'computed_at')::timestamptz;
  if computed is null or computed>now()+interval '5 minutes' or (score_record->'explanation'->>'asOf')::timestamptz is distinct from computed then raise exception 'Invalid score timestamp'; end if;
  if q.stock_id is not null and (score_record->'explanation'->'quoteEvidence'->>'fetchedAt')::timestamptz is distinct from q.fetched_at then raise exception 'Quote input mismatch'; end if;
  if exists(select 1 from public.scores s where s.stock_id=sid and s.as_of=(score_record->>'as_of')::date and s.horizon=(score_record->>'horizon')::public.ranking_horizon and s.model_version=score_record->>'model_version' and (s.computed_at>computed or s.inputs_as_of>(dataset->>'fetchedAt')::timestamptz)) then raise exception 'Stale score refused'; end if;
  perform public.ingest_financials(dataset);
  select * into strict f from public.financial_snapshots where stock_id=sid;
  if f.payload is distinct from dataset then raise exception 'Financial version changed; recompute'; end if;
  -- One RPC / one transaction: score failure rolls back ALL financial writes and version changes.
  insert into public.scores(stock_id,as_of,horizon,model_version,value,insufficient_reason,inputs_as_of,computed_at,explanation,financial_version,quote_version,financial_inputs,quote_inputs)
  values(sid,(score_record->>'as_of')::date,(score_record->>'horizon')::public.ranking_horizon,score_record->>'model_version',(score_record->>'value')::numeric,score_record->>'insufficient_reason',f.fetched_at,computed,score_record->'explanation',f.version,q.version,f.payload,case when q.stock_id is null then null else to_jsonb(q) end)
  on conflict(stock_id,as_of,horizon,model_version) do update set value=excluded.value,insufficient_reason=excluded.insufficient_reason,inputs_as_of=excluded.inputs_as_of,computed_at=excluded.computed_at,explanation=excluded.explanation,financial_version=excluded.financial_version,quote_version=excluded.quote_version,financial_inputs=excluded.financial_inputs,quote_inputs=excluded.quote_inputs;
end $$;
revoke all on function public.persist_financial_score(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_financial_score(jsonb,jsonb) to service_role;

-- Old providers inferred this solely from the date. Clear unsupported finality claims.
update public.prices_history set is_final=false where is_final;
alter table public.prices_history add constraint source_finality_unverified check(is_final=false);

create table public.catalog_sync_state (
  source text primary key check(source='KBS'), observed_at timestamptz not null, row_count integer not null check(row_count>=100)
);
alter table public.catalog_sync_state enable row level security;
alter table public.catalog_sync_state force row level security;
revoke all on public.catalog_sync_state from public,anon,authenticated;
grant select,insert,update on public.catalog_sync_state to service_role;
create function public.reconcile_stock_catalog(rows jsonb,complete boolean,observed_at timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
declare cnt integer; previous_count integer; latest timestamptz;
begin
  if complete is distinct from true or jsonb_typeof(rows) is distinct from 'array' then raise exception 'Incomplete catalog refused'; end if;
  cnt:=jsonb_array_length(rows);
  if cnt<100 or observed_at is null or observed_at>now()+interval '5 minutes' then raise exception 'Catalog too short or timestamp invalid'; end if;
  if (select count(distinct r->>'symbol') from jsonb_array_elements(rows) r)<>cnt or exists(select 1 from jsonb_array_elements(rows) r where coalesce(r->>'symbol','') !~ '^[A-Z0-9]{3,12}$' or coalesce(length(r->>'name'),0) not between 1 and 300 or r->>'source' is distinct from 'KBS' or coalesce(r->>'exchange','') not in ('HOSE','HNX','UPCOM')) then raise exception 'Invalid catalog row'; end if;
  if (select count(distinct r->>'exchange') from jsonb_array_elements(rows) r)<>3 then raise exception 'Missing exchange in catalog'; end if;
  perform pg_catalog.pg_advisory_xact_lock(419,1);
  select c.observed_at into latest from public.catalog_sync_state c where source='KBS';
  if latest is not null and latest>observed_at then raise exception 'Stale catalog refused'; end if;
  select count(*) into previous_count from public.stocks where source='KBS' and active;
  -- A successful HTTP response is not evidence that a heavily truncated catalog is complete.
  if previous_count>0 and cnt<previous_count*0.98 then raise exception 'Large catalog drop requires review'; end if;
  if exists(select 1 from public.stocks s where s.source='KBS' and s.active group by s.exchange having (select count(*) from jsonb_array_elements(rows) r where r->>'exchange'=s.exchange::text)<count(*)*0.95) then raise exception 'Exchange catalog drop requires review'; end if;
  insert into public.stocks(symbol,name,exchange,source,source_verified_at,search_text,active)
  select r.symbol,r.name,r.exchange::public.exchange_code,'KBS',observed_at,r.search_text,true from jsonb_to_recordset(rows) as r(symbol text,name text,exchange text,search_text text)
  on conflict(symbol) do update set name=excluded.name,exchange=excluded.exchange,source=excluded.source,source_verified_at=excluded.source_verified_at,search_text=excluded.search_text,active=true;
  update public.stocks s set active=false where s.source='KBS' and s.active and not exists(select 1 from jsonb_array_elements(rows) r where r->>'symbol'=s.symbol);
  insert into public.catalog_sync_state values('KBS',observed_at,cnt) on conflict(source) do update set observed_at=excluded.observed_at,row_count=excluded.row_count;
end $$;
revoke all on function public.reconcile_stock_catalog(jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_stock_catalog(jsonb,boolean,timestamptz) to service_role;
commit;
