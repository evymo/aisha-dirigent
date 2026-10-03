-- ============================================================================
-- Source of Truth: hub_import_job
-- Popis: Connector Hub — per-sync audit / processing-queue view (generic over
--        all sources). One row per sync run.
--        Spravováno: the connector service.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_import_job (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid         NOT NULL REFERENCES public.hub_source(id) ON DELETE CASCADE,
  started_at       timestamptz  NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text         NOT NULL DEFAULT 'running',
  snapshot_token   text,
  records_read     integer      NOT NULL DEFAULT 0,
  records_upserted integer      NOT NULL DEFAULT 0,
  records_failed   integer      NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hub_import_job IS 'Connector Hub: per-sync audit / processing-queue view (generic over all sources).';

ALTER TABLE public.hub_import_job ENABLE ROW LEVEL SECURITY;
