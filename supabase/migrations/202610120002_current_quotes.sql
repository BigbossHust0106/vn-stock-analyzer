begin;
-- Snapshot hiện tại, không phải OHLCV lịch sử. Fetched_at không phải timestamp sàn.
create table public.prices_current (
  stock_id uuid primary key references public.stocks(id),
  reference_vnd numeric(24,6) not null check(reference_vnd > 0 and reference_vnd <> 'NaN'::numeric),
  ceiling_vnd numeric(24,6) not null check(ceiling_vnd > 0 and ceiling_vnd <> 'NaN'::numeric),
  floor_vnd numeric(24,6) not null check(floor_vnd > 0 and floor_vnd <> 'NaN'::numeric),
  last_price_vnd numeric(24,6) check(last_price_vnd > 0 and last_price_vnd <> 'NaN'::numeric),
  bid3_price_vnd numeric(24,6) check(bid3_price_vnd > 0 and bid3_price_vnd <> 'NaN'::numeric),
  last_volume_raw bigint not null check(last_volume_raw >= 0),
  lot_raw bigint not null check(lot_raw >= 0 and lot_raw <= 900719925474099),
  -- Đồng bộ với VPS_LOT_SIZE=10 trong cấu hình provider; KHÔNG áp dụng cho last_volume_raw.
  vps_lot_size smallint not null default 10 check(vps_lot_size = 10),
  total_volume_shares bigint generated always as (lot_raw * vps_lot_size) stored,
  volume_verification_scope text not null default 'ACB_2026-10-12_only' check(volume_verification_scope = 'ACB_2026-10-12_only'),
  last_volume_unit text not null default 'unverified' check(last_volume_unit = 'unverified'),
  total_volume_unit text not null default 'shares' check(total_volume_unit = 'shares'),
  price_basis text not null default 'unverified' check(price_basis = 'unverified'),
  last_price_semantics text not null default 'inferred_from_field_name' check(last_price_semantics = 'inferred_from_field_name'),
  fetched_at timestamptz not null,
  check(floor_vnd <= reference_vnd and reference_vnd <= ceiling_vnd)
);
create index prices_current_fetched_idx on public.prices_current(fetched_at desc);

alter table public.prices_current enable row level security;
alter table public.prices_current force row level security;
create policy market_read on public.prices_current for select to anon, authenticated using(true);
revoke all on public.prices_current from anon, authenticated;
grant select on public.prices_current to anon, authenticated;
grant all on public.prices_current to service_role;

create function public.ingest_current_quotes(rows jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare expected_count integer; matched_count integer;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then raise exception 'No quotes'; end if;
  expected_count := jsonb_array_length(rows);
  if expected_count = 0 then raise exception 'No quotes'; end if;
  select count(*) into matched_count from jsonb_to_recordset(rows) as r(symbol text)
    join public.stocks s on s.symbol=r.symbol and s.active;
  if matched_count <> expected_count then raise exception 'Unknown or inactive symbol'; end if;
  insert into public.prices_current(stock_id,reference_vnd,ceiling_vnd,floor_vnd,last_price_vnd,bid3_price_vnd,last_volume_raw,lot_raw,fetched_at)
  select s.id,r.reference_vnd,r.ceiling_vnd,r.floor_vnd,r.last_price_vnd,r.bid3_price_vnd,r.last_volume_raw,r.lot_raw,r.fetched_at
  from jsonb_to_recordset(rows) as r(symbol text,reference_vnd numeric,ceiling_vnd numeric,floor_vnd numeric,last_price_vnd numeric,bid3_price_vnd numeric,last_volume_raw bigint,lot_raw bigint,fetched_at timestamptz)
  join public.stocks s on s.symbol=r.symbol
  on conflict(stock_id) do update set reference_vnd=excluded.reference_vnd,ceiling_vnd=excluded.ceiling_vnd,floor_vnd=excluded.floor_vnd,last_price_vnd=excluded.last_price_vnd,bid3_price_vnd=excluded.bid3_price_vnd,last_volume_raw=excluded.last_volume_raw,lot_raw=excluded.lot_raw,fetched_at=excluded.fetched_at
  where excluded.fetched_at > public.prices_current.fetched_at;
end $$;
revoke all on function public.ingest_current_quotes(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_current_quotes(jsonb) to service_role;
commit;
