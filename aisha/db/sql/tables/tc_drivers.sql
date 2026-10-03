-- ============================================================================
-- Source of Truth: tc_drivers
-- Popis: Řidiči/osoby importované z T-cars API (osobySeznam).
--        Spravováno: svc-tcars přes tc_upsert_drivers_audited.
--        erp_employee_ref je ruční mapování na interní osobní číslo / ERP
--        zaměstnance — import ho nikdy nepřepisuje.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tc_drivers (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_driver_id      integer      NOT NULL,
  name              text,
  personal_number   text,
  phone             text,
  mobile            text,
  email             text,
  group_id          integer,
  group_name        text,
  cost_center_id    integer,
  position          text,
  active            boolean      NOT NULL DEFAULT true,
  erp_employee_ref  text,
  raw_data          jsonb,
  last_import_at    timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT tc_drivers_tc_driver_id_key UNIQUE (tc_driver_id)
);

COMMENT ON TABLE public.tc_drivers IS 'Řidiči/osoby z T-cars (SOAP osobySeznam), upsert přes tc_upsert_drivers_audited';
COMMENT ON COLUMN public.tc_drivers.tc_driver_id IS 'osobaId z T-cars API — externí identita osoby';
COMMENT ON COLUMN public.tc_drivers.personal_number IS 'osobaCislo — osobní číslo';
COMMENT ON COLUMN public.tc_drivers.erp_employee_ref IS 'Ruční mapování na ERP zaměstnance — import nepřepisuje';

ALTER TABLE public.tc_drivers ENABLE ROW LEVEL SECURITY;
