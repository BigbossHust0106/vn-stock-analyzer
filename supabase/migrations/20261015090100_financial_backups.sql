begin;
create table public.financial_report_backups(
 stock_id uuid not null references public.stocks(id),
 source text not null check(source='VIETCAP_REPORTS'),
 fetched_at timestamptz not null,
 payload jsonb not null check(coalesce(payload->>'source'='VIETCAP_REPORTS' and payload->>'verification'='raw_provider_only' and payload->>'usableForScoring'='false' and jsonb_typeof(payload->'reports')='object',false)),
 last_error text,
 primary key(stock_id,source)
);
alter table public.financial_report_backups enable row level security;
alter table public.financial_report_backups force row level security;
create policy market_read on public.financial_report_backups for select to anon,authenticated using(true);
revoke all on public.financial_report_backups from public,anon,authenticated;
grant select on public.financial_report_backups to anon,authenticated;
grant select,insert,update on public.financial_report_backups to service_role;
create function public.protect_financial_backup() returns trigger language plpgsql set search_path='' as $$
declare sym text; section text;
begin
 select symbol into strict sym from public.stocks where id=new.stock_id;
 if new.payload->>'symbol' is distinct from sym or (new.payload->>'fetchedAt')::timestamptz is distinct from new.fetched_at or new.fetched_at>now()+interval '5 minutes' then raise exception 'Invalid backup identity/timestamp';end if;
 foreach section in array array['BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW'] loop
  if jsonb_typeof(new.payload->'reports'->section) is distinct from 'array' or jsonb_array_length(new.payload->'reports'->section)=0 then raise exception 'Empty backup refused';end if;
 end loop;
 if tg_op='UPDATE' then
  if new.fetched_at<old.fetched_at then raise exception 'Older backup refused';end if;
  foreach section in array array['BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW'] loop
   if jsonb_array_length(new.payload->'reports'->section)<jsonb_array_length(old.payload->'reports'->section)
    or (select max((p->>'year')::int) from jsonb_array_elements(new.payload->'reports'->section) p)<(select max((p->>'year')::int) from jsonb_array_elements(old.payload->'reports'->section) p)
    or exists(select 1 from jsonb_array_elements(old.payload->'reports'->section) o join jsonb_array_elements(new.payload->'reports'->section) n on o->>'year'=n->>'year' cross join lateral jsonb_each(o->'fields') f where jsonb_typeof(f.value)='number' and jsonb_typeof(n->'fields'->f.key) is distinct from 'number')
    then raise exception 'Backup regression refused';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.protect_financial_backup() from public,anon,authenticated;
create trigger protect_financial_backup before insert or update on public.financial_report_backups for each row execute function public.protect_financial_backup();
commit;
