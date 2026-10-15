\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.news_sources(id,name,terms_url,state,checked_at,note) values('unit','Synthetic RSS fixture','https://cafef.vn/rss.chn','ok',now(),'test only');
insert into public.news_feed_articles(id,source_id,source_url,title,excerpt,fingerprint,published_at,fetched_at,symbols)
values(repeat('a',64),'unit','https://cafef.vn/test-only','DPR thông báo cổ tức bằng tiền','Thông báo trích xuất phục vụ kiểm thử.',repeat('b',64),now(),now(),array['DPR']);
do $$ begin
 begin update public.news_feed_articles set analysis_status='ok',analysis='{}',model='test',analyzed_at=now() where id=repeat('a',64);raise exception 'Empty LLM accepted';exception when check_violation then null;end;
 begin update public.news_feed_articles set analysis_status='ok',analysis='{"summary":"Lợi nhuận tăng 999 tỷ","evidence":"Lợi nhuận tăng 999 tỷ","sentiment":"positive","impact":"high","horizon":"short"}',model='test',analyzed_at=now() where id=repeat('a',64);raise exception 'Invented evidence accepted';exception when check_violation then null;end;
 begin perform public.ranking_batch_inputs(now(),0,101);raise exception 'Unbounded ranking page allowed';exception when raise_exception then if sqlerrm<>'Invalid ranking page' then raise;end if;end;
 if not public.claim_news_ingestion() then raise exception 'First lease refused';end if;
 if public.claim_news_ingestion() then raise exception 'Concurrent cron acquired lease';end if;
 perform public.release_news_ingestion();
 if not public.claim_news_ingestion() then raise exception 'Released lease stuck';end if;
end $$;
update public.news_feed_articles set analysis_status='ok',analysis='{"summary":"DPR thông báo cổ tức bằng tiền","evidence":"DPR thông báo cổ tức bằng tiền","sentiment":"neutral","impact":"medium","horizon":"short"}',model='test-model',analyzed_at=now() where id=repeat('a',64);
set local role anon;
do $$ begin
 if not exists(select 1 from public.news_feed_articles where id=repeat('a',64) and analysis_status='ok') then raise exception 'News public read failed';end if;
 begin update public.news_feed_articles set title='Tampered' where id=repeat('a',64);raise exception 'Anon news write allowed';exception when insufficient_privilege then null;end;
 begin perform public.claim_news_ingestion();raise exception 'Anon lease allowed';exception when insufficient_privilege then null;end;
 begin perform public.ranking_batch_inputs(now());raise exception 'Anon batch input allowed';exception when insufficient_privilege then null;end;
 begin insert into public.news_scores(stock_id,payload,updated_at) values(gen_random_uuid(),'{}',now());raise exception 'Anon score forge allowed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$ begin
 begin delete from public.news_feed_articles where id=repeat('a',64);raise exception 'User news delete allowed';exception when insufficient_privilege then null;end;
 begin update public.news_sources set state='ok';raise exception 'User source forge allowed';exception when insufficient_privilege then null;end;
 begin perform public.release_news_ingestion();raise exception 'User lease allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
\echo 'NEWS DB PASS: public evidence read; server-only writes/score/lease; no invented/empty LLM evidence; concurrent Cron excluded'
