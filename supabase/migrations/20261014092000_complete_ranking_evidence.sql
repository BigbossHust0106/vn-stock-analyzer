begin;
create function public.ranking_is_eligible(explanation jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(
  explanation#>>'{rankingEligibility,policy}'='complete-v1'
  and explanation#>'{rankingEligibility,eligible}'='true'::jsonb
  and explanation#>'{rankingEligibility,quoteVerified}'='true'::jsonb
  and explanation#>'{rankingEligibility,financialCoverage}'='1'::jsonb
  and explanation->'coverage'='1'::jsonb
  and explanation#>'{rankingEligibility,blockers}'='[]'::jsonb, false);
$$;
revoke all on function public.ranking_is_eligible(jsonb) from public;
grant execute on function public.ranking_is_eligible(jsonb) to anon,authenticated,service_role;
-- Persist the exact observations read by rankingRows, including labelled reference-only inputs.
create or replace function public.publish_rankings(day date, stamp timestamptz, rows jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare n integer; previous timestamptz;
begin
 if day is null or stamp is null or not isfinite(stamp) or day <> (stamp at time zone 'Asia/Ho_Chi_Minh')::date or stamp>now()+interval '5 minutes' or jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)=0 then raise exception 'Invalid ranking batch'; end if;
 perform pg_advisory_xact_lock(740104);
 select computed_at into previous from public.ranking_runs where as_of=day and model_version='top10-v1';
 if previous is not null and previous>stamp then return; end if;
 select count(distinct r->>'stock_id') into n from jsonb_array_elements(rows) r;
 if jsonb_array_length(rows)<>n*3 or exists(select 1 from jsonb_array_elements(rows) r group by r->>'stock_id' having count(distinct r->>'horizon')<>3) then raise exception 'Incomplete ranking horizons'; end if;
 delete from public.rankings where as_of=day and model_version='top10-v1';
 insert into public.scores(stock_id,as_of,horizon,model_version,value,insufficient_reason,inputs_as_of,computed_at,explanation,financial_version,quote_version,financial_inputs,quote_inputs)
 select r.stock_id,day,r.horizon,'top10-v1',r.value,r.insufficient_reason,r.inputs_as_of,stamp,r.explanation,r.financial_version,r.quote_version,r.financial_inputs,r.quote_inputs
 from jsonb_to_recordset(rows) as r(stock_id uuid,horizon public.ranking_horizon,value numeric,insufficient_reason text,inputs_as_of timestamptz,explanation jsonb,financial_version uuid,quote_version uuid,financial_inputs jsonb,quote_inputs jsonb)
 on conflict(stock_id,as_of,horizon,model_version) do update set value=excluded.value,insufficient_reason=excluded.insufficient_reason,inputs_as_of=excluded.inputs_as_of,computed_at=excluded.computed_at,explanation=excluded.explanation,financial_version=excluded.financial_version,quote_version=excluded.quote_version,financial_inputs=excluded.financial_inputs,quote_inputs=excluded.quote_inputs;
 insert into public.rankings(as_of,horizon,model_version,stock_id,score_id,position)
 select day,horizon,'top10-v1',stock_id,id,row_number() over(partition by horizon order by value desc,stock_id)
 from public.scores where as_of=day and model_version='top10-v1' and value is not null and public.ranking_is_eligible(explanation) and stock_id in(select (r->>'stock_id')::uuid from jsonb_array_elements(rows) r);
 insert into public.ranking_runs values(day,'top10-v1',stamp,n) on conflict(as_of,model_version) do update set computed_at=excluded.computed_at,universe_count=excluded.universe_count;
 select count(*) into n from (select horizon from public.rankings where as_of=day and model_version='top10-v1' group by horizon having count(*)>=10) complete;
 update public.system_status set state=case when n=3 then 'ok' else 'degraded' end,last_success_at=case when n=3 then stamp else last_success_at end,updated_at=now() where component='rankings';
end $$;
revoke all on function public.publish_rankings(date,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.publish_rankings(date,timestamptz,jsonb) to service_role;


delete from public.rankings r using public.scores s where r.score_id=s.id and r.model_version='top10-v1' and not public.ranking_is_eligible(s.explanation);
create or replace function public.top_rankings(period public.ranking_horizon, market text default null, industry text default null, min_cap numeric default null, max_cap numeric default null)
returns table(stock_id uuid,symbol text,name text,exchange public.exchange_code,sector text,"position" bigint,as_of date,computed_at timestamptz,score numeric,explanation jsonb,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,s.exchange,s.sector,row_number() over(order by c.value desc,s.symbol),r.as_of,c.computed_at,c.value,c.explanation || jsonb_build_object('quoteSource',case when q.fetched_at>=now()-interval '24 hours' then 'VPS' else 'KBS reference' end),
 case when q.fetched_at>=now()-interval '24 hours' then q.last_price_vnd else null end,
 case when q.fetched_at>=now()-interval '24 hours' then q.reference_vnd else ref.reference_vnd end,
 case when q.fetched_at>=now()-interval '24 hours' then q.fetched_at else ref.fetched_at end
 from public.rankings r join public.scores c on c.id=r.score_id join public.stocks s on s.id=r.stock_id left join public.prices_current q on q.stock_id=s.id left join public.ranking_reference_prices ref on ref.stock_id=s.id
 where r.model_version='top10-v1' and r.horizon=period and r.as_of=(select max(t.as_of) from public.ranking_runs t where t.model_version='top10-v1') and s.active and public.ranking_is_eligible(c.explanation)
 and (market is null or s.exchange::text=market) and (industry is null or s.sector=industry)
 and (min_cap is null or (c.explanation->>'marketCapVnd')::numeric>=min_cap) and (max_cap is null or (c.explanation->>'marketCapVnd')::numeric<max_cap)
 order by c.value desc,s.symbol limit 10;
$$;
create or replace function public.ranking_candidates(period public.ranking_horizon, market text default null, industry text default null, min_cap numeric default null, max_cap numeric default null)
returns table(stock_id uuid,symbol text,name text,exchange public.exchange_code,sector text,"position" bigint,as_of date,computed_at timestamptz,score numeric,explanation jsonb,price_vnd numeric,reference_vnd numeric,quote_fetched_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select s.id,s.symbol,s.name,s.exchange,s.sector,null::bigint,c.as_of,c.computed_at,c.value,c.explanation || jsonb_build_object('quoteSource',case when q.fetched_at>=now()-interval '24 hours' then 'VPS' else 'KBS reference' end),
 case when q.fetched_at>=now()-interval '24 hours' then q.last_price_vnd else null end,
 case when q.fetched_at>=now()-interval '24 hours' then q.reference_vnd else ref.reference_vnd end,
 case when q.fetched_at>=now()-interval '24 hours' then q.fetched_at else ref.fetched_at end
 from public.scores c join public.stocks s on s.id=c.stock_id left join public.prices_current q on q.stock_id=s.id left join public.ranking_reference_prices ref on ref.stock_id=s.id
 where c.model_version='top10-v1' and c.horizon=period and c.as_of=(select max(t.as_of) from public.ranking_runs t where t.model_version='top10-v1') and s.active and not public.ranking_is_eligible(c.explanation)
 and (market is null or s.exchange::text=market) and (industry is null or s.sector=industry)
 and (min_cap is null or (c.explanation->>'marketCapVnd')::numeric>=min_cap) and (max_cap is null or (c.explanation->>'marketCapVnd')::numeric<max_cap)
 order by s.symbol limit 100;
$$;
revoke all on function public.ranking_candidates(public.ranking_horizon,text,text,numeric,numeric) from public;
grant execute on function public.ranking_candidates(public.ranking_horizon,text,text,numeric,numeric) to anon,authenticated,service_role;
-- Old ingestion clients cannot silently erase primary-document observations.
create function public.preserve_document_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(
  select 1 from jsonb_array_elements(coalesce(old.payload->'documentEvidence','[]'::jsonb)) e
  where not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'documentEvidence','[]'::jsonb)) n where n->'year'=e->'year')
 ) then raise exception 'Verified document evidence regression';end if;
 return new;
end $$;
create trigger preserve_document_evidence before update on public.financial_snapshots for each row execute function public.preserve_document_evidence();
update public.system_status set state='degraded',updated_at=now() where component='rankings' and not exists(select 1 from public.rankings where model_version='top10-v1');
notify pgrst, 'reload schema';
commit;
