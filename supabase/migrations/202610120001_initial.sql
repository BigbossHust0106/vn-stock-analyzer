begin;

create type public.exchange_code as enum ('HOSE', 'HNX', 'UPCOM');
create type public.ranking_horizon as enum ('day', 'month', 'quarter');
create type public.price_basis as enum ('adjusted', 'unadjusted');

create table public.stocks (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique check (symbol ~ '^[A-Z0-9]{3,12}$'),
  exchange public.exchange_code not null,
  name text not null check (length(name) between 1 and 300),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Lịch được nhập từ nguồn xác minh. Không tạo phiên bằng cách loại cuối tuần.
create table public.trading_sessions (
  session_date date primary key,
  is_open boolean not null,
  closes_at timestamptz,
  source text not null check (length(source) > 0),
  verified_at timestamptz not null,
  check ((is_open and closes_at is not null and (closes_at at time zone 'Asia/Ho_Chi_Minh')::date = session_date) or (not is_open and closes_at is null))
);

create table public.prices_daily (
  stock_id uuid not null references public.stocks(id),
  session_date date not null references public.trading_sessions(session_date),
  price_basis public.price_basis not null,
  open_vnd numeric(24,6) not null check (open_vnd > 0 and open_vnd <> 'NaN'::numeric),
  high_vnd numeric(24,6) not null check (high_vnd > 0 and high_vnd <> 'NaN'::numeric),
  low_vnd numeric(24,6) not null check (low_vnd > 0 and low_vnd <> 'NaN'::numeric),
  close_vnd numeric(24,6) not null check (close_vnd > 0 and close_vnd <> 'NaN'::numeric),
  volume_shares bigint not null check (volume_shares >= 0),
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (stock_id, session_date, price_basis),
  check (high_vnd >= greatest(open_vnd, close_vnd, low_vnd) and low_vnd <= least(open_vnd, close_vnd))
);
create index prices_daily_session_idx on public.prices_daily(session_date desc, stock_id);

create table public.fundamentals (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id),
  period_end date not null,
  period_basis text not null check (period_basis in ('annual', 'ttm', 'quarter')),
  eps_vnd numeric(24,6) check (eps_vnd <> 'NaN'::numeric),
  bvps_vnd numeric(24,6) check (bvps_vnd >= 0 and bvps_vnd <> 'NaN'::numeric),
  fcfe_vnd numeric(30,6) check (fcfe_vnd <> 'NaN'::numeric),
  shares_outstanding bigint check (shares_outstanding > 0),
  published_at timestamptz not null,
  source text not null,
  unique(stock_id, period_end, period_basis)
);
create index fundamentals_lookup_idx on public.fundamentals(stock_id, period_basis, published_at desc);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id),
  as_of date not null,
  horizon public.ranking_horizon not null,
  model_version text not null,
  value numeric(6,3) check (value between 0 and 100),
  insufficient_reason text,
  inputs_as_of timestamptz not null,
  computed_at timestamptz not null default now(),
  unique(stock_id, as_of, horizon, model_version),
  unique(id, stock_id, as_of, horizon, model_version),
  check ((value is null and insufficient_reason is not null and insufficient_reason = 'không đủ dữ liệu') or (value is not null and insufficient_reason is null))
);
create table public.rankings (
  as_of date not null,
  horizon public.ranking_horizon not null,
  model_version text not null,
  stock_id uuid not null,
  score_id uuid not null,
  position integer not null check (position > 0),
  primary key(as_of, horizon, model_version, stock_id),
  unique(as_of, horizon, model_version, position),
  foreign key(score_id, stock_id, as_of, horizon, model_version) references public.scores(id, stock_id, as_of, horizon, model_version)
);
create index rankings_stock_idx on public.rankings(stock_id, as_of desc);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  unique(owner_id, id),
  unique(owner_id, name)
);
create table public.watchlist_items (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  watchlist_id uuid not null,
  stock_id uuid not null references public.stocks(id),
  created_at timestamptz not null default now(),
  primary key(watchlist_id, stock_id),
  foreign key(owner_id, watchlist_id) references public.watchlists(owner_id, id) on delete cascade
);
create index watchlist_items_owner_idx on public.watchlist_items(owner_id, watchlist_id);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  stock_id uuid not null references public.stocks(id),
  watchlist_id uuid,
  kind text not null check (kind in ('price_above', 'price_below', 'score_above')),
  threshold numeric(24,6) not null check (threshold > 0 and threshold <> 'NaN'::numeric),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(owner_id, watchlist_id) references public.watchlists(owner_id, id) on delete cascade,
  check (kind <> 'score_above' or threshold <= 100)
);
create index alerts_owner_idx on public.alerts(owner_id, created_at desc);
create index alerts_enabled_stock_idx on public.alerts(stock_id, kind) where enabled;

create table public.news_articles (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  url text not null unique check (url ~ '^https://'),
  title text not null,
  published_at timestamptz not null,
  stock_id uuid references public.stocks(id),
  ingested_at timestamptz not null default now()
);
create index news_articles_published_idx on public.news_articles(published_at desc);
create index news_articles_stock_idx on public.news_articles(stock_id, published_at desc);
create table public.news_sentiment (
  article_id uuid not null references public.news_articles(id) on delete cascade,
  model_version text not null,
  value numeric(6,5) check (value between -1 and 1),
  confidence numeric(6,5) check (confidence between 0 and 1),
  computed_at timestamptz not null default now(),
  primary key(article_id, model_version)
);

create table public.user_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Ho_Chi_Minh' check (timezone = 'Asia/Ho_Chi_Minh'),
  email_alerts boolean not null default false,
  default_horizon public.ranking_horizon not null default 'month'
);
-- Chỉ chứa trạng thái an toàn để công khai; tuyệt đối không lưu credential/error raw.
create table public.system_status (
  component text primary key check (component in ('prices', 'fundamentals', 'rankings', 'news')),
  state text not null check (state in ('pending', 'ok', 'degraded')),
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.system_status(component,state) values ('prices','pending'),('fundamentals','pending'),('rankings','pending'),('news','pending');

do $$
declare t text;
begin
  foreach t in array array['stocks','trading_sessions','prices_daily','fundamentals','scores','rankings','news_articles','news_sentiment','system_status'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy market_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['watchlists','watchlist_items','alerts','user_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy owner_access on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

commit;
