-- Index: idx_twin_parameter_definitions_entity_type
-- Source of truth pair: aisha/db/sql/tables/twin_parameter_definitions.sql

CREATE INDEX IF NOT EXISTS idx_twin_parameter_definitions_entity_type
  ON public.twin_parameter_definitions (entity_type);
