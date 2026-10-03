-- Index: uq_twin_events_source_ref
-- Source of truth pair: aisha/db/sql/tables/twin_events.sql
-- Idempotence importu: opakovaný běh stejného okna aktualizuje, neduplikuje.

CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_events_source_ref
  ON public.twin_events (source, event_type, source_ref)
  WHERE source_ref IS NOT NULL;
