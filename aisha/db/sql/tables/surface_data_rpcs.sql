-- Allowlist datových RPC pro get_block_data dispatcher. Bez řádku zde nelze RPC z bloku volat.
-- Řádky = instance data (seed per implementace).

create table if not exists public.surface_data_rpcs (
  rpc_name    text primary key
              check (rpc_name ~ '^[a-z][a-z0-9_]*$'),
  description text not null default '',
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.surface_data_rpcs is
  'Allowlist of data RPCs callable by get_block_data. No dynamic RPC names outside this table.';

ALTER TABLE public.surface_data_rpcs ENABLE ROW LEVEL SECURITY;
