-- ============================================================================
-- Source of Truth: tc_import_log
-- Popis: Log importních běhů z T-cars (veškeré importy logované a opakovatelné).
--        Řádek vzniká na startu běhu a uzavírá se po dokončení/chybě přes
--        tc_record_import_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tc_import_log (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type       text         NOT NULL,
  status            text         NOT NULL DEFAULT 'running',
  started_at        timestamptz  NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  records_total     integer,
  records_upserted  integer,
  records_failed    integer,
  error_message     text,
  details           jsonb,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT tc_import_log_status_check
    CHECK (status IN ('running', 'success', 'error')),
  CONSTRAINT tc_import_log_import_type_check
    CHECK (import_type IN ('vehicles', 'drivers', 'groups', 'rides'))
);

COMMENT ON TABLE public.tc_import_log IS 'Průběh a výsledky importních běhů svc-tcars';
COMMENT ON COLUMN public.tc_import_log.import_type IS 'Typ importu — fáze 1: vehicles/drivers/groups/rides';

ALTER TABLE public.tc_import_log ENABLE ROW LEVEL SECURITY;
