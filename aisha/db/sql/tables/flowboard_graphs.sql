-- ============================================================================
-- Source of Truth: flowboard_graphs
-- Purpose: Versioned, engine-agnostic AISHA Flowboard graphs (the visual agent
--          / automation builder). One row per saved flow; the `graph` JSONB is
--          the canonical FlowGraph (nodes + edges + meta) validated app-side by
--          src/lib/flowboard/graph.ts. Same lifecycle as a GrapesJS page:
--          AISHA drafts → user edits on canvas → publish → versioned.
-- Managed by: save_flowboard_graph() / get_flowboard_graph() /
--             list_flowboard_graphs() (SECURITY DEFINER RPCs). Compilation to
--             n8n / sandbox happens app-side; run provenance lands in
--             story_entries (entry_type flow_run | automation_step).
-- Taxonomy:  status / engine_pin are open text by design (no CHECK) — AISHA can
--            extend without a schema change, consistent with agent_phase_catalog.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.flowboard_graphs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text,
  name         text        NOT NULL DEFAULT 'Nový flow',
  -- Canonical FlowGraph JSON (nodes/edges/meta). Validated app-side.
  graph        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version      integer     NOT NULL DEFAULT 1,
  -- draft | published | archived | … (open text by design).
  status       text        NOT NULL DEFAULT 'draft',
  -- NULL = let selectEngine decide; 'n8n' | 'sandbox' to pin.
  engine_pin   text,
  created_by   uuid        REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS: ENABLE here (the ALTER references no function, so it is cold-start-safe in the
-- table SoT, and the production-build gate requires ENABLE in tables/*.sql). The POLICIES
-- live in aisha/db/sql/rls/flowboard_graphs.sql — they reference auth.uid()/is_admin_or_staff(),
-- so they are emitted after functions. RPC-only: direct table DML reserved for service_role.
ALTER TABLE public.flowboard_graphs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flowboard_graphs TO service_role;

COMMENT ON TABLE public.flowboard_graphs IS
  'Versioned engine-agnostic AISHA Flowboard graphs (visual agent/automation builder). graph JSONB = canonical FlowGraph; compiled app-side to n8n/sandbox, provenance flows to story_entries.';
COMMENT ON COLUMN public.flowboard_graphs.engine_pin IS
  'NULL = selectEngine decides; n8n | sandbox to pin the execution target.';
