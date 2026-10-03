-- ============================================================================
-- Source of Truth: twin_entities
-- Popis: Katalog entit digitálních dvojčat (vozidlo, řidič, místo, měřidlo…) —
--        vendor-neutrální doménové jádro NAD zdrojovými sily (wd_*, li_*).
--        Zdrojové systémy se na dvojčata MAPUJÍ přes twin_external_refs;
--        jejich tvary do jádra neprotékají (deštník doktrína).
--        entity_type je volný slug — typy jsou doménová/instance data,
--        jádro žádný vendor ani doménový enum nezná.
--        Spravováno: twin_upsert_entity_audited (service/adaptéry).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.twin_entities (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text         NOT NULL,
  label        text,
  status       text         NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'inactive', 'archived')),
  metadata     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_entities_entity_type_not_blank CHECK (btrim(entity_type) <> '')
);

COMMENT ON TABLE public.twin_entities IS 'Digitální dvojčata — vendor-neutrální entity nad zdrojovými sily; zdroje se mapují přes twin_external_refs';
COMMENT ON COLUMN public.twin_entities.entity_type IS 'Volný slug typu (vehicle/driver/place/meter…) — typy definují instance data, ne jádro';
COMMENT ON COLUMN public.twin_entities.status IS 'active = živá entita; inactive = deaktivovaná zdrojem (nemaže se); archived = ručně odložená';
COMMENT ON COLUMN public.twin_entities.metadata IS 'Doplňkové vlastnosti bez vlastního sloupce; autoritativní hodnoty patří do observations/events, ne sem';

ALTER TABLE public.twin_entities ENABLE ROW LEVEL SECURITY;
