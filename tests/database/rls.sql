\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
insert into public.stocks(id,symbol,exchange,name) values ('20000000-0000-4000-8000-000000000001','AAA','HOSE','Fixture — không phải dữ liệu thực'), ('20000000-0000-4000-8000-000000000003','BBB','HOSE','Fixture thứ hai');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
insert into public.watchlists(id,name) values ('30000000-0000-4000-8000-000000000002','B');
insert into public.watchlist_items(watchlist_id,stock_id) values ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001');
insert into public.alerts(id,stock_id,watchlist_id,kind,threshold) values ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','price_above',100);
insert into public.user_settings(email_alerts) values(true);
do $$ begin
  if (select count(*) from public.watchlists) <> 1 or (select count(*) from public.alerts) <> 1 or (select count(*) from public.watchlist_items) <> 1 or (select count(*) from public.user_settings) <> 1 then raise exception 'B cannot read own data'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into public.watchlists(id,name) values ('30000000-0000-4000-8000-000000000001','A');
insert into public.alerts(id,stock_id,kind,threshold) values ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','price_below',50);
insert into public.user_settings(email_alerts) values(false);
do $$ declare affected integer; t text; begin
  if (select count(*) from public.watchlists) <> 1 or exists(select 1 from public.watchlists where name='B') or (select count(*) from public.alerts) <> 1 or (select count(*) from public.watchlist_items) <> 0 or (select count(*) from public.user_settings) <> 1 then raise exception 'A can read B'; end if;
  foreach t in array array['watchlists','alerts','user_settings','watchlist_items'] loop
    execute format('update public.%I set owner_id=owner_id where owner_id=%L',t,'10000000-0000-4000-8000-000000000002');
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'A can update B: %',t; end if;
    execute format('delete from public.%I where owner_id=%L',t,'10000000-0000-4000-8000-000000000002');
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'A can delete B: %',t; end if;
  end loop;
  begin
    insert into public.watchlists(owner_id,name) values('10000000-0000-4000-8000-000000000002','forged');
    raise exception 'A can insert as B';
  exception when insufficient_privilege then null; end;
  begin
    update public.watchlists set owner_id='10000000-0000-4000-8000-000000000002' where name='A';
    raise exception 'A can change owner';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.watchlist_items(watchlist_id,stock_id) values('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
    raise exception 'A can attach item to B';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.alerts(stock_id,watchlist_id,kind,threshold) values('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','price_above',10);
    raise exception 'A can attach alert to B';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.alerts(owner_id,stock_id,kind,threshold) values('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','price_above',10);
    raise exception 'A can forge alert owner';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_settings(owner_id) values('10000000-0000-4000-8000-000000000002');
    raise exception 'A can forge settings owner';
  exception when insufficient_privilege then null; end;
  update public.watchlists set name='A updated' where name='A';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own update failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select name from public.watchlists) <> 'B' or (select count(*) from public.alerts) <> 1 or (select count(*) from public.watchlist_items) <> 1 or not (select email_alerts from public.user_settings) then raise exception 'B data changed'; end if;
  if exists(select 1 from public.watchlists where name='A updated') then raise exception 'B can see A'; end if;
end $$;
reset role;
set local role anon;
do $$ declare t text; n integer; begin
  foreach t in array array['stocks','trading_sessions','prices_daily','fundamentals','scores','rankings','news_articles','news_sentiment','system_status','prices_current'] loop
    execute format('select count(*) from public.%I',t) into n;
  end loop;
  if (select count(*) from public.stocks) <> 2 then raise exception 'Public market read failed'; end if;
  foreach t in array array['watchlists','watchlist_items','alerts','user_settings'] loop
    begin execute format('select count(*) from public.%I',t); raise exception 'Anon reads private: %',t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    insert into public.stocks(symbol,exchange,name) values('BAD','HOSE','bad');
    raise exception 'Anon can write market';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ingest_current_quotes('[]'::jsonb);
    raise exception 'Anon can ingest';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from pg_tables where schemaname='public' and not rowsecurity) then raise exception 'Missing RLS'; end if;
end $$;
rollback;
\echo RLS PASS: A/B isolation, own read/write, owner forgery, parent ownership, anonymous market read, market write denied
