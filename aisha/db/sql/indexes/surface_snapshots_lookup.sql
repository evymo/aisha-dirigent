-- Index: surface_snapshots_lookup
-- Table: surface_snapshots

create index if not exists surface_snapshots_lookup
  on public.surface_snapshots (surface, published_at desc);
