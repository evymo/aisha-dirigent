-- ============================================================================
-- Source of Truth: tc_vehicles
-- Popis: Vozidla/stroje importované z T-cars API (vozidlaSeznam).
--        Spravováno: svc-tcars přes tc_upsert_vehicles_audited.
--        Vyřazená vozidla se nemažou — jen active=false (vozidloVyrazeno).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tc_vehicles (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_vehicle_id       integer      NOT NULL,
  model               text,
  plate               text,
  evidence_no         text,
  unit_no             text,
  group_id            integer,
  group_name          text,
  responsible_id      integer,
  responsible_name    text,
  responsible_since   date,
  cost_center_id      integer,
  cost_center_name    text,
  kind                text,
  category            text,
  emission_norm       text,
  fuel_primary        text,
  fuel_alt            text,
  purchase_price      numeric(14,2),
  first_registration  date,
  active              boolean      NOT NULL DEFAULT true,
  raw_data            jsonb,
  last_import_at      timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT tc_vehicles_tc_vehicle_id_key UNIQUE (tc_vehicle_id)
);

COMMENT ON TABLE public.tc_vehicles IS 'Vozidla/stroje z T-cars (SOAP vozidlaSeznam), upsert přes tc_upsert_vehicles_audited';
COMMENT ON COLUMN public.tc_vehicles.tc_vehicle_id IS 'vozidloId z T-cars API — externí identita vozidla';
COMMENT ON COLUMN public.tc_vehicles.plate IS 'vozidloRz — registrační značka';
COMMENT ON COLUMN public.tc_vehicles.unit_no IS 'vozidloCisloPalubniJednotky — výrobní číslo palubní GPS jednotky';
COMMENT ON COLUMN public.tc_vehicles.raw_data IS 'Kompletní surová položka tVozidlo (vč. spotřeby, číselníků)';

ALTER TABLE public.tc_vehicles ENABLE ROW LEVEL SECURITY;
