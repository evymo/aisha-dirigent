-- Table: coolify_app_slots
-- Per-service blue/green slot state. Spravováno WF_BLUE_GREEN_ORCHESTRATOR.
-- Stateful služby (DB, MinIO, Keycloak) zde nemají záznam — používají rolling restart.
-- Source: docs/deploy/BLUE_GREEN_DESIGN.md (Phase 2 of AUTONOMOUS_DEPLOY_FLOW.md)

CREATE TABLE IF NOT EXISTS public.coolify_app_slots (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name              text         NOT NULL UNIQUE,
  story_id              uuid REFERENCES public.partner_stories ON DELETE SET NULL,                        -- NULL pro AISHA-stack system apps; FK soft (no CASCADE)
  blue_app_uuid         text         NOT NULL,
  green_app_uuid        text         NOT NULL,
  active_slot           text         NOT NULL CHECK (active_slot IN ('blue', 'green')),
  blue_image_tag        text,
  green_image_tag       text,
  blue_health           text         NOT NULL DEFAULT 'unknown'
                        CHECK (blue_health IN ('healthy', 'degraded', 'down', 'unknown')),
  green_health          text         NOT NULL DEFAULT 'unknown'
                        CHECK (green_health IN ('healthy', 'degraded', 'down', 'unknown')),
  last_switch_at        timestamptz,
  last_switch_by        uuid,                        -- user_id approvera (NULL = AISHA autonomous)
  switch_lock           boolean      NOT NULL DEFAULT false,
  switch_lock_at        timestamptz,
  switch_lock_by        text,                        -- workflow execution ID
  domain                text,                        -- veřejná doména
  internal_domain_blue  text,
  internal_domain_green text,
  metadata              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_distinct_uuids CHECK (blue_app_uuid <> green_app_uuid)
);

COMMENT ON TABLE public.coolify_app_slots IS
  'Per-service blue/green slot state. Spravováno WF_BLUE_GREEN_ORCHESTRATOR.  Stateful služby (DB, MinIO, Keycloak) zde nemají záznam — používají rolling restart.';
COMMENT ON COLUMN public.coolify_app_slots.story_id IS
  'NULL pro system-managed AISHA stack apps; UUID pro user story apps (referenčně, no CASCADE).';
COMMENT ON COLUMN public.coolify_app_slots.switch_lock IS
  'Atomic switch lock. Auto-released po 10 min (stale lock detection).';
COMMENT ON COLUMN public.coolify_app_slots.switch_lock_by IS
  'Workflow execution ID nebo similar identifier držitele zámku.';

ALTER TABLE public.coolify_app_slots ENABLE ROW LEVEL SECURITY;
