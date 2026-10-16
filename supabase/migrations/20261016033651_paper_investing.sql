begin;
create table public.paper_wallets (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80),initial_capital_vnd numeric(24,0) not null check(initial_capital_vnd between 100000 and 1000000000000),
 cash_vnd numeric(24,0) not null check(cash_vnd between 0 and 4000000000000000),realized_vnd numeric(24,0) not null default 0,
 fee_bps integer not null check(fee_bps between 0 and 100),tax_bps integer not null check(tax_bps between 0 and 100),
 request_id uuid not null,created_at timestamptz not null default now(),unique(owner_id,id),unique(owner_id,request_id)
);
create index paper_wallets_owner on public.paper_wallets(owner_id,created_at desc,id desc);
create table public.paper_quotes (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 stock_id uuid not null references public.stocks(id),symbol text not null,
 price_vnd bigint not null check(price_vnd>0 and price_vnd<1000000000),observed_at timestamptz not null check(isfinite(observed_at)),
 mode text not null check(mode in('source','cached')),price_date date,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '2 minutes',used_at timestamptz,
 unique(owner_id,id)
);
create index paper_quotes_owner_time on public.paper_quotes(owner_id,created_at desc);
create index paper_quotes_marks on public.paper_quotes(owner_id,stock_id,observed_at desc,created_at desc);
create table public.paper_positions (
 owner_id uuid not null,wallet_id uuid not null,stock_id uuid not null references public.stocks(id),
 quantity bigint not null check(quantity between 0 and 1000000000 and quantity%100=0),cost_vnd numeric(24,0) not null check(cost_vnd between 0 and 4000000000000000),
 primary key(wallet_id,stock_id),foreign key(owner_id,wallet_id) references public.paper_wallets(owner_id,id) on delete cascade,
 check(quantity>0 or cost_vnd=0)
);
create index paper_positions_owner on public.paper_positions(owner_id,wallet_id);
create table public.paper_trades (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,wallet_id uuid not null,quote_id uuid not null unique,
 request_id uuid not null,symbol text not null,side text not null check(side in('buy','sell')),quantity integer not null check(quantity between 100 and 1000000 and quantity%100=0),
 price_vnd bigint not null,gross_vnd numeric(24,0) not null,fee_vnd numeric(24,0) not null,tax_vnd numeric(24,0) not null,
 realized_vnd numeric(24,0) not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(owner_id,wallet_id) references public.paper_wallets(owner_id,id) on delete cascade,
 foreign key(owner_id,quote_id) references public.paper_quotes(owner_id,id) on delete cascade,
 unique(wallet_id,request_id)
);
create index paper_trades_page on public.paper_trades(owner_id,wallet_id,created_at desc,id desc);
do $$ declare t text;begin
 foreach t in array array['paper_wallets','paper_quotes','paper_positions','paper_trades'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('create policy own_read on public.%I for select to authenticated using((select auth.uid())=owner_id)',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.paper_create_wallet(owner uuid,label text,capital bigint,fee integer,tax integer,request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.paper_wallets;
begin
 if owner is null or request is null or label is null or length(trim(label)) not between 1 and 80 or capital is null or capital not between 100000 and 1000000000000 or fee is null or tax is null or fee not between 0 and 100 or tax not between 0 and 100 then raise exception 'PAPER_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,8031));
 select * into w from public.paper_wallets where owner_id=owner and request_id=request;
 if found then
  if w.name<>trim(label) or w.initial_capital_vnd<>capital or w.fee_bps<>fee or w.tax_bps<>tax then raise exception 'PAPER_REQUEST_REUSED';end if;
  return to_jsonb(w);
 end if;
 if (select count(*) from public.paper_wallets where owner_id=owner)>=20 then raise exception 'PAPER_WALLET_LIMIT';end if;
 insert into public.paper_wallets(owner_id,name,initial_capital_vnd,cash_vnd,fee_bps,tax_bps,request_id) values(owner,trim(label),capital,capital,fee,tax,request) returning * into w;
 return to_jsonb(w);
end $$;

create function public.paper_create_quote(owner uuid,sid uuid,price bigint,observed timestamptz,price_mode text,bar_day date default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.stocks;q public.paper_quotes;tick integer;
begin
 if owner is null or price is null or price<=0 or price>=1000000000 or observed is null or not isfinite(observed) or observed>clock_timestamp()+interval '5 seconds' or price_mode is null or price_mode not in('source','cached') then raise exception 'PAPER_NO_PRICE';end if;
 if observed<clock_timestamp()-(case when price_mode='source' then interval '2 minutes' else interval '14 days' end) or (bar_day is not null and (bar_day>=(now() at time zone 'Asia/Ho_Chi_Minh')::date or bar_day<(now() at time zone 'Asia/Ho_Chi_Minh')::date-14)) then raise exception 'PAPER_OLD_PRICE';end if;
 select * into s from public.stocks where id=sid and active;
 if not found then raise exception 'PAPER_STOCK_MISSING';end if;
 tick:=case when s.exchange='HOSE' then case when price<10000 then 10 when price<50000 then 50 else 100 end else 100 end;
 if price%tick<>0 then raise exception 'PAPER_TICK';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,8032));
 if (select count(*) from public.paper_quotes where owner_id=owner and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'PAPER_RATE_LIMIT';end if;
 delete from public.paper_quotes where id in(select p.id from public.paper_quotes p where p.owner_id=owner and p.created_at<now()-interval '7 days' and not exists(select 1 from public.paper_trades t where t.quote_id=p.id) order by p.created_at limit 50);
 insert into public.paper_quotes(owner_id,stock_id,symbol,price_vnd,observed_at,mode,price_date) values(owner,sid,s.symbol,price,observed,price_mode,bar_day) returning * into q;
 return to_jsonb(q);
end $$;

create function public.paper_execute_order(owner uuid,wallet uuid,quote uuid,action text,shares integer,request uuid,accept_cached boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.paper_wallets;q public.paper_quotes;p public.paper_positions;t public.paper_trades;gross numeric;fee numeric;tax numeric;allocated numeric:=0;profit numeric:=0;proceeds numeric;
begin
 if owner is null or wallet is null or quote is null or request is null or action is null or action not in('buy','sell') or shares is null or shares not between 100 and 1000000 or shares%100<>0 then raise exception 'PAPER_INVALID';end if;
 select * into w from public.paper_wallets where id=wallet and owner_id=owner for update;
 if not found then raise exception 'PAPER_WALLET_MISSING';end if;
 select * into t from public.paper_trades where wallet_id=wallet and request_id=request;
 if found then
  if t.side<>action or t.quantity<>shares or t.quote_id<>quote then raise exception 'PAPER_REQUEST_REUSED';end if;
  return to_jsonb(t);
 end if;
 select * into q from public.paper_quotes where id=quote and owner_id=owner for update;
 if not found then raise exception 'PAPER_NO_PRICE';end if;
 if q.used_at is not null then raise exception 'PAPER_QUOTE_USED';end if;
 if q.expires_at<=clock_timestamp() then raise exception 'PAPER_QUOTE_EXPIRED';end if;
 if q.mode='cached' and accept_cached is distinct from true then raise exception 'PAPER_ACCEPT_CACHED';end if;
 if not exists(select 1 from public.stocks where id=q.stock_id and active) then raise exception 'PAPER_STOCK_MISSING';end if;
 if (select count(*) from public.paper_trades where owner_id=owner and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'PAPER_RATE_LIMIT';end if;
 select * into p from public.paper_positions where wallet_id=wallet and stock_id=q.stock_id;
 gross:=q.price_vnd::numeric*shares;fee:=ceil(gross*w.fee_bps/10000);tax:=case when action='sell' then ceil(gross*w.tax_bps/10000) else 0 end;
 if action='buy' then
  if w.cash_vnd<gross+fee then raise exception 'PAPER_INSUFFICIENT_CASH';end if;
  if coalesce(p.quantity,0)=0 and (select count(*) from public.paper_positions where wallet_id=wallet and quantity>0)>=50 then raise exception 'PAPER_POSITION_LIMIT';end if;
  update public.paper_wallets set cash_vnd=cash_vnd-gross-fee where id=wallet;
  insert into public.paper_positions(owner_id,wallet_id,stock_id,quantity,cost_vnd) values(owner,wallet,q.stock_id,shares,gross+fee)
  on conflict(wallet_id,stock_id) do update set quantity=public.paper_positions.quantity+excluded.quantity,cost_vnd=public.paper_positions.cost_vnd+excluded.cost_vnd;
 else
  if coalesce(p.quantity,0)<shares then raise exception 'PAPER_INSUFFICIENT_SHARES';end if;
  allocated:=case when shares=p.quantity then p.cost_vnd else round(p.cost_vnd*shares/p.quantity) end;
  proceeds:=gross-fee-tax;profit:=proceeds-allocated;
  update public.paper_wallets set cash_vnd=cash_vnd+proceeds,realized_vnd=realized_vnd+profit where id=wallet;
  update public.paper_positions set quantity=quantity-shares,cost_vnd=cost_vnd-allocated where wallet_id=wallet and stock_id=q.stock_id;
 end if;
 insert into public.paper_trades(owner_id,wallet_id,quote_id,request_id,symbol,side,quantity,price_vnd,gross_vnd,fee_vnd,tax_vnd,realized_vnd)
 values(owner,wallet,quote,request,q.symbol,action,shares,q.price_vnd,gross,fee,tax,profit) returning * into t;
 update public.paper_quotes set used_at=clock_timestamp() where id=quote;
 return to_jsonb(t);
end $$;
revoke all on function public.paper_create_wallet(uuid,text,bigint,integer,integer,uuid),public.paper_create_quote(uuid,uuid,bigint,timestamptz,text,date),public.paper_execute_order(uuid,uuid,uuid,text,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.paper_create_wallet(uuid,text,bigint,integer,integer,uuid),public.paper_create_quote(uuid,uuid,bigint,timestamptz,text,date),public.paper_execute_order(uuid,uuid,uuid,text,integer,uuid,boolean) to service_role;

create function public.paper_wallet_positions(wallet uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('symbol',s.symbol,'name',s.name,'mark',m.mark) order by s.symbol),'[]'::jsonb)
 from public.paper_positions p join public.stocks s on s.id=p.stock_id
 left join lateral (
  select jsonb_build_object('price_vnd',v.price,'observed_at',v.observed,'mode',v.mode,'price_date',v.price_date) mark from (
   select c.last_price_vnd price,c.fetched_at observed,'market-cache'::text mode,null::date price_date from public.prices_current c where c.stock_id=p.stock_id and c.last_price_vnd>0 and c.fetched_at<=now()
   union all
   (select q.price_vnd,q.observed_at,q.mode,q.price_date from public.paper_quotes q where q.owner_id=(select auth.uid()) and q.stock_id=p.stock_id and q.observed_at<=now() order by q.observed_at desc,q.created_at desc limit 1)
  )v order by v.observed desc limit 1
 )m on true
 where p.wallet_id=wallet and p.owner_id=(select auth.uid()) and p.quantity>0;
$$;
revoke all on function public.paper_wallet_positions(uuid) from public;
grant execute on function public.paper_wallet_positions(uuid) to authenticated,service_role;
-- A single MVCC snapshot: cash, positions and ledger cannot come from different fills.
create function public.paper_snapshot(wallet uuid default null,before_time timestamptz default null,before_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare w public.paper_wallets;wallet_list jsonb;history jsonb;next_page jsonb:=null;
begin
 if (before_time is null)<>(before_id is null) or (before_time is not null and not isfinite(before_time)) then raise exception 'PAPER_INVALID';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into wallet_list from(select * from public.paper_wallets where owner_id=(select auth.uid()) order by created_at desc,id desc limit 20)x;
 select * into w from public.paper_wallets where owner_id=(select auth.uid()) and (wallet is null or id=wallet) order by created_at desc,id desc limit 1;
 if w.id is null then
  if wallet is not null then raise exception 'PAPER_WALLET_MISSING';end if;
  return jsonb_build_object('wallets',wallet_list,'wallet',null,'positions','[]'::jsonb,'trades','[]'::jsonb,'next',null);
 end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into history from(
  select * from public.paper_trades where owner_id=(select auth.uid()) and wallet_id=w.id and (before_time is null or (created_at,id)<(before_time,before_id)) order by created_at desc,id desc limit 21
 )t;
 if jsonb_array_length(history)>20 then
  history:=history-20;
  next_page:=jsonb_build_object('before',history#>>'{19,created_at}','id',history#>>'{19,id}');
 end if;
 return jsonb_build_object('wallets',wallet_list,'wallet',to_jsonb(w),'positions',public.paper_wallet_positions(w.id),'trades',history,'next',next_page,'asOf',now());
end $$;
revoke all on function public.paper_snapshot(uuid,timestamptz,uuid) from public;
grant execute on function public.paper_snapshot(uuid,timestamptz,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
