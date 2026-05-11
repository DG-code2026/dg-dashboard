-- Run this once in the Supabase SQL editor to create the clientes table.
-- After running, the server's /api/db/clientes endpoints will work.

create table if not exists public.clientes (
  id              bigserial primary key,
  nombre          text not null,
  email           text,
  comitente       text,
  broker          text,
  telefono        text,        -- normalized +54 ... format
  telefono_raw    text,        -- original from source for audit
  tipo_cuenta     text check (tipo_cuenta in ('PF', 'PJ')),
  fecha_nacimiento date,
  asesor          text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists clientes_comitente_idx on public.clientes (comitente);
create index if not exists clientes_asesor_idx    on public.clientes (asesor);
create index if not exists clientes_broker_idx    on public.clientes (broker);
create index if not exists clientes_nombre_trgm   on public.clientes using gin (nombre gin_trgm_ops);
-- pg_trgm enables fast ILIKE/substring search on `nombre`. If the extension
-- is not enabled in this project, run once:  create extension if not exists pg_trgm;
