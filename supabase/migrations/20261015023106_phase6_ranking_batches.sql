begin;
-- Read one bounded page of complete market inputs; no N+1 HTTP requests per issuer.
create function public.ranking_batch_inputs(stamp timestamptz, offset_rows integer default 0, batch_size integer default 100)
returns table(stock_id uuid,financial_payload jsonb,financial_version uuid,current_quote jsonb,reference_quote jsonb,bars jsonb,events jsonb,news_payload jsonb)
language plpgsql stable security invoker set search_path='' as $$
begin
 if stamp is null or not isfinite(stamp) or offset_rows is null or batch_size is null or offset_rows<0 or batch_size not between 1 and 100 then raise exception 'Invalid ranking page'; end if;
 return query
 select s.id,f.payload,f.version,to_jsonb(q),to_jsonb(ref),
 coalesce((select jsonb_agg(to_jsonb(b)) from (select p.session_date,p.close_vnd,p.volume_shares,p.price_basis,p.source from public.prices_daily p where p.stock_id=s.id and p.session_date<=(stamp at time zone 'Asia/Ho_Chi_Minh')::date order by p.session_date desc limit 220)b),'[]'::jsonb),
 coalesce((select jsonb_agg(jsonb_build_object('event_date',e.event_date,'kind',e.kind,'title',e.title,'source_url',e.source_url,'known_at',e.known_at)) from public.corporate_events e where e.stock_id=s.id and e.event_date>=(stamp at time zone 'Asia/Ho_Chi_Minh')::date and e.known_at<=stamp),'[]'::jsonb),
 case when n.updated_at between stamp-interval '1 hour' and stamp then n.payload else null end
 from public.stocks s join public.financial_snapshots f on f.stock_id=s.id
 left join public.prices_current q on q.stock_id=s.id left join public.ranking_reference_prices ref on ref.stock_id=s.id left join public.news_scores n on n.stock_id=s.id
 where s.active order by s.id limit batch_size offset offset_rows;
end $$;
revoke all on function public.ranking_batch_inputs(timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.ranking_batch_inputs(timestamptz,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
