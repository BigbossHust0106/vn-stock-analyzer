begin;
create table public.news_sources (
 id text primary key, name text not null, terms_url text not null check(terms_url ~ '^https://'),
 state text not null check(state in('ok','failed','policy_blocked','robots_blocked')),
 checked_at timestamptz not null, article_count integer not null default 0 check(article_count>=0), note text not null
);
create table public.news_feed_articles (
 id text primary key check(id ~ '^[0-9a-f]{64}$'), source_id text not null references public.news_sources(id),
 source_url text not null unique check(source_url ~ '^https://(cafef\.vn|vietstock\.vn|vneconomy\.vn|vnexpress\.net)/'),
 title text not null check(length(title) between 1 and 300), excerpt text not null check(length(excerpt)<=700),
 fingerprint text not null unique check(fingerprint ~ '^[0-9a-f]{64}$'),
 published_at timestamptz not null, fetched_at timestamptz not null,
 symbols text[] not null default '{}', sectors text[] not null default '{}', factors text[] not null default '{}',macro_topics text[] not null default '{}',
 analysis_status text not null default 'pending' check(analysis_status in('pending','ok','failed')),
 analysis jsonb, model text, analyzed_at timestamptz,analysis_attempts integer not null default 0 check(analysis_attempts between 0 and 3),last_attempt_at timestamptz,
 check(published_at<=fetched_at+interval '5 minutes'),
 check(factors <@ array['macro','sector','corporate','foreign','liquidity']),
 check(macro_topics <@ array['interest','fx','cpi','sbv','oil','gold']),
 check(coalesce((analysis_status='ok' and analysis is not null and analyzed_at is not null and model is not null
 and analysis->>'sentiment' in('positive','neutral','negative') and analysis->>'impact' in('high','medium','low') and analysis->>'horizon' in('short','medium','long')
 and jsonb_typeof(analysis->'summary')='string' and jsonb_typeof(analysis->'evidence')='string'
 and length(analysis->>'summary') between 10 and 360 and length(analysis->>'evidence') between 10 and 500
 and position(analysis->>'summary' in title||' '||excerpt)>0 and position(analysis->>'evidence' in title||' '||excerpt)>0 and position(analysis->>'summary' in analysis->>'evidence')>0
 ) or (analysis_status<>'ok' and analysis is null and analyzed_at is null),false))
);
create index news_feed_articles_time on public.news_feed_articles(published_at desc);
create index news_feed_articles_symbols on public.news_feed_articles using gin(symbols);
create table public.news_scores (
 stock_id uuid primary key references public.stocks(id) on delete cascade,
 score numeric check(score between 0 and 100),payload jsonb not null, updated_at timestamptz not null
);
create table public.news_ingestion_lock (id boolean primary key default true check(id),locked_until timestamptz not null);
insert into public.news_ingestion_lock values(true,'2000-01-01');
create function public.claim_news_ingestion() returns boolean language sql security invoker set search_path='' as $$
 with claimed as(update public.news_ingestion_lock set locked_until=now()+interval '10 minutes' where id and locked_until<now() returning id) select exists(select 1 from claimed);
$$;
create function public.release_news_ingestion() returns void language sql security invoker set search_path='' as $$ update public.news_ingestion_lock set locked_until=now()-interval '1 second' where id; $$;
revoke all on function public.claim_news_ingestion(),public.release_news_ingestion() from public,anon,authenticated;
grant execute on function public.claim_news_ingestion(),public.release_news_ingestion() to service_role;
alter table public.news_sources enable row level security;
alter table public.news_feed_articles enable row level security;
alter table public.news_scores enable row level security;
alter table public.news_ingestion_lock enable row level security;
grant select on public.news_sources,public.news_feed_articles,public.news_scores to anon,authenticated;
grant all on public.news_sources,public.news_feed_articles,public.news_scores,public.news_ingestion_lock to service_role;
create policy news_sources_read on public.news_sources for select to anon,authenticated using(true);
create policy news_feed_articles_read on public.news_feed_articles for select to anon,authenticated using(true);
create policy news_scores_read on public.news_scores for select to anon,authenticated using(true);
-- The private lock has no policies. Only the server service role can claim it.
insert into public.system_status(component,state) values('news','degraded') on conflict(component) do nothing;
create function public.ranking_news_inputs(period public.ranking_horizon, market text default null, industry text default null, min_cap numeric default null, max_cap numeric default null)
returns table(stock_id uuid,symbol text,name text,exchange public.exchange_code,sector text,"position" bigint,as_of date,computed_at timestamptz,score numeric,explanation jsonb,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,s.exchange,s.sector,null::bigint,c.as_of,c.computed_at,c.value,c.explanation || jsonb_build_object('quoteSource',case when q.fetched_at>=now()-interval '24 hours' then 'VPS' else 'KBS reference' end),
 case when q.fetched_at>=now()-interval '24 hours' then q.last_price_vnd else null end,
 case when q.fetched_at>=now()-interval '24 hours' then q.reference_vnd else ref.reference_vnd end,
 case when q.fetched_at>=now()-interval '24 hours' then q.fetched_at else ref.fetched_at end
 from public.scores c join public.stocks s on s.id=c.stock_id left join public.prices_current q on q.stock_id=s.id left join public.ranking_reference_prices ref on ref.stock_id=s.id
 where c.model_version='top10-v1' and c.horizon=period and c.as_of=(select max(t.as_of) from public.ranking_runs t where t.model_version='top10-v1') and s.active
 and (market is null or s.exchange::text=market) and (industry is null or s.sector=industry)
 and (min_cap is null or (c.explanation->>'marketCapVnd')::numeric>=min_cap) and (max_cap is null or (c.explanation->>'marketCapVnd')::numeric<max_cap)
 order by s.symbol limit 2001;
$$;

revoke all on function public.ranking_news_inputs(public.ranking_horizon,text,text,numeric,numeric) from public;
grant execute on function public.ranking_news_inputs(public.ranking_horizon,text,text,numeric,numeric) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
