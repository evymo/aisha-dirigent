-- ============================================================================
-- Source of Truth: hub_attribute_source
-- Popis: Connector Hub — per-attribute provenance (value+source+confidence+
--        priority) for multi-source merge resolution. The greenfield provenance
--        plane; populated once a second source can contradict the registry.
--        Spravováno: the connectors (on normalize).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_attribute_source (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    text         NOT NULL,
  entity_key     text         NOT NULL,
  attribute      text         NOT NULL,
  value          text,
  source_id      uuid         REFERENCES public.hub_source(id) ON DELETE SET NULL,
  confidence     numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  priority       integer      NOT NULL DEFAULT 0,
  snapshot_token text,
  imported_at    timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hub_attribute_source IS 'Connector Hub: per-attribute provenance (value+source+confidence+priority) — multi-source merge resolution.';

ALTER TABLE public.hub_attribute_source ENABLE ROW LEVEL SECURITY;
