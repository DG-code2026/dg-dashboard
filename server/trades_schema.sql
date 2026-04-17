-- Run this once in the Supabase SQL editor to create the trades table.
create table if not exists public.trades (
  id bigserial primary key,
  tag text not null default '',
  client_name text not null default '',
  client_account text not null default '',
  broker text not null default 'PPI',
  trade_date date not null default current_date,
  ticker text not null,
  instrument_type text not null default 'BONOS_PUBLICOS',
  settlement text not null default 'A-24HS',
  currency text not null default 'ARS',
  price numeric,
  quantity numeric default 100,
  target_type text not null default 'price',
  target_value numeric,
  stop_loss numeric,
  commission numeric default 0,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trades_tag_idx on public.trades(tag);
create index if not exists trades_ticker_idx on public.trades(ticker);
