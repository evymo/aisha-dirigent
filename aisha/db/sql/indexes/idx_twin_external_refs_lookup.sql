-- Index: idx_twin_external_refs_lookup
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Runtime resolve (ac_dallas → osoba) čte podle klíče zdroje.

CREATE INDEX IF NOT EXISTS idx_twin_external_refs_lookup
  ON public.twin_external_refs (source, source_key);
