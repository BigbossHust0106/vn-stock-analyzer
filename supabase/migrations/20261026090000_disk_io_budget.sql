begin;
-- Bounded lock waits: fail safely instead of blocking production writers indefinitely.
set local lock_timeout='3s';
set local statement_timeout='60s';
create index if not exists stocks_active_symbol_io_idx on public.stocks(symbol) include(id,source) where active;
create index if not exists scores_freshness_io_idx on public.scores(computed_at desc);
create index if not exists scores_financial_lookup_io_idx on public.scores(stock_id,financial_version,computed_at desc);
create index if not exists news_fetched_io_idx on public.news_feed_articles(fetched_at desc);
create index if not exists news_analyzed_io_idx on public.news_feed_articles(analyzed_at desc) where analyzed_at is not null;
create index if not exists job_retention_io_idx on public.system_job_runs(scheduled_at);

create function public.io_skip_unchanged_history() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'fetched_at') is not distinct from (to_jsonb(old)-'fetched_at') then return null; end if;
 return new;
end $$;
create trigger io_history_noop before update on public.prices_history for each row execute function public.io_skip_unchanged_history();
create trigger io_fundamentals_noop before update on public.fundamentals for each row execute function public.io_skip_unchanged_history();

create function public.io_skip_duplicate_quote() returns trigger language plpgsql set search_path='' as $$
begin
 -- Generated total_volume_shares is unavailable in BEFORE triggers; raw lot is compared.
 -- Preserve observation metadata at most once/minute when all quote facts are identical.
 if new.fetched_at < old.fetched_at+interval '60 seconds'
   and (to_jsonb(new)-array['fetched_at','version','total_volume_shares']) is not distinct from
       (to_jsonb(old)-array['fetched_at','version','total_volume_shares']) then return null; end if;
 return new;
end $$;
-- Alphabetical trigger order places this before version_quote; skipped writes keep the version.
create trigger io_quote_noop before update on public.prices_current for each row execute function public.io_skip_duplicate_quote();
revoke all on function public.io_skip_unchanged_history(),public.io_skip_duplicate_quote() from public,anon,authenticated;
-- No grants, RLS policies, source contracts, scoring definitions or source timestamps are relaxed.
commit;
