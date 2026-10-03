-- ============================================================================
-- Source of Truth: tc_groups
-- Popis: Organizační jednotky/skupiny z T-cars API (skupinySeznam).
--        Spravováno: svc-tcars přes tc_upsert_groups_audited.
--        parent_id je hierarchie (skupinaNadrizena) — self reference přes
--        tc_group_id, FK se NEvynucuje (částečné importy).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tc_groups (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_group_id       integer      NOT NULL,
  name              text,
  number            text,
  parent_id         integer,
  leader_id         integer,
  leader_name       text,
  cost_center_id    integer,
  cost_center_name  text,
  active            boolean      NOT NULL DEFAULT true,
  raw_data          jsonb,
  last_import_at    timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT tc_groups_tc_group_id_key UNIQUE (tc_group_id)
);

COMMENT ON TABLE public.tc_groups IS 'Skupiny/organizační jednotky z T-cars (SOAP skupinySeznam), upsert přes tc_upsert_groups_audited';
COMMENT ON COLUMN public.tc_groups.tc_group_id IS 'skupinaId z T-cars API — externí identita skupiny';
COMMENT ON COLUMN public.tc_groups.parent_id IS 'skupinaNadrizena.skupinaId — nadřízená skupina (hierarchie)';

ALTER TABLE public.tc_groups ENABLE ROW LEVEL SECURITY;
