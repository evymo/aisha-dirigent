-- Index: idx_twin_external_refs_proposed
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Ratifikační fronta (twin_identity_list_unmatched) čte jen proposed.

CREATE INDEX IF NOT EXISTS idx_twin_external_refs_proposed
  ON public.twin_external_refs (created_at)
  WHERE state = 'proposed';
