begin;
-- NULL LIMIT means unlimited in PostgreSQL. Reject direct REST calls as well as HTTP.
create or replace function public.backtest_history(period public.ranking_horizon, before_time timestamptz default null, before_id uuid default null, take integer default 10) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if take is null or take not between 1 and 10 or (before_time is null)<>(before_id is null) then raise exception 'Invalid pagination';end if;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('legs',(
  select jsonb_object_agg(h,coalesce((select jsonb_agg(public.backtest_leg((m->>'stock_id')::uuid,c.recorded_at,n)||jsonb_build_object('symbol',m->>'symbol')) from jsonb_array_elements(c.items) m),'[]'::jsonb))
  from (values('day',0),('month',1),('quarter',3)) periods(h,n)
 )) order by c.recorded_at desc,c.id desc),'[]'::jsonb) into result
 from (select * from public.ranking_publications where horizon=period and (before_time is null or (recorded_at,id)<(before_time,before_id)) order by recorded_at desc,id desc limit take) c;
 return result;
end $$;
revoke all on function public.backtest_history(public.ranking_horizon,timestamptz,uuid,integer) from public;
grant execute on function public.backtest_history(public.ranking_horizon,timestamptz,uuid,integer) to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
