-- Index: idx_twin_entities_entity_type
-- Source of truth pair: aisha/db/sql/tables/twin_entities.sql

CREATE INDEX IF NOT EXISTS idx_twin_entities_entity_type
  ON public.twin_entities (entity_type);
