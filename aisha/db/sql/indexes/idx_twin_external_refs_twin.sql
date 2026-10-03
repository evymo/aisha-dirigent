-- Index: idx_twin_external_refs_twin
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql

CREATE INDEX IF NOT EXISTS idx_twin_external_refs_twin
  ON public.twin_external_refs (twin_id);
