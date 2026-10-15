begin;
-- Preserve earlier migration history; TP1/TP2/TP3 may coexist in one watchlist.
alter table public.watchlist_alert_rules drop constraint watchlist_alert_rules_owner_id_watchlist_id_stock_id_kind_h_key;
alter table public.watchlist_alert_rules add constraint watchlist_alert_rule_level unique nulls not distinct(owner_id,watchlist_id,stock_id,kind,horizon,lower_vnd,upper_vnd);
commit;
