-- ============================================================================
-- Source of Truth: hub_source
-- Popis: Connector Hub — registered data sources (the connector registry).
--        One row per feed (registry, EDI supplier, VIN API, bank). config holds
--        endpoint/token REFERENCES, never secrets.
--        Spravováno: the connector service (read) + admin.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_source (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text         NOT NULL UNIQUE,
  kind         text         NOT NULL,
  display_name text         NOT NULL,
  config       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hub_source IS 'Connector Hub: registered data sources (connector registry). config holds endpoint/token REFERENCES, never secrets.';

ALTER TABLE public.hub_source ENABLE ROW LEVEL SECURITY;
