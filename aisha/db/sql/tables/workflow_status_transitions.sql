-- Table: workflow_status_transitions
-- Per-(from_status, to_status) lookup of legal kanban lifecycle transitions
-- on partner_stories.status. Parallel to delivery_transition_rules — same
-- shape, different domain.
--
-- A row exists IFF the transition is legal. Absence of a row = illegal
-- transition (update_story_status_audited rejects with ERRCODE 22023).
--
-- Optional `requires_role` enforces admin/staff gating server-side.
-- NULL = any authenticated owner of the story may perform the transition.
--
-- Initial seed (see migrations) mirrors today's permissive behavior so
-- the FK + validator rollout is non-breaking. Operators can tighten via
-- a later admin tool without schema changes.

CREATE SEQUENCE IF NOT EXISTS public.workflow_status_transitions_id_seq;

CREATE TABLE IF NOT EXISTS public.workflow_status_transitions (
  id integer PRIMARY KEY DEFAULT nextval('public.workflow_status_transitions_id_seq'::regclass),

  -- Source state. Both columns FK to workflow_statuses(status) so a
  -- status can't be soft-deleted without also disabling its transitions.
  from_status text NOT NULL REFERENCES public.workflow_statuses(status),
  to_status   text NOT NULL REFERENCES public.workflow_statuses(status),

  -- Role gating. NULL = any owner; 'admin' = is_admin_or_staff() required.
  -- Matches delivery_transition_rules semantics.
  requires_role text,

  -- Soft-disable a rule without dropping it.
  is_active boolean NOT NULL DEFAULT true,

  -- Operator notes — surfaces in admin transition manager.
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One canonical row per (from, to) pair.
  UNIQUE (from_status, to_status),

  -- Prevent self-loops at the schema level (no UI value, easy to seed wrong).
  CHECK (from_status <> to_status)
);

ALTER SEQUENCE public.workflow_status_transitions_id_seq
  OWNED BY public.workflow_status_transitions.id;

ALTER TABLE public.workflow_status_transitions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.workflow_status_transitions IS
  'Legal (from_status, to_status) pairs for partner_stories.status. Parallel to delivery_transition_rules but for the kanban lifecycle. Enforced by update_story_status_audited.';

-- Indexes live in aisha/db/sql/indexes/idx_workflow_status_transitions_lookup.sql
-- per SQL Source Separation rule.
