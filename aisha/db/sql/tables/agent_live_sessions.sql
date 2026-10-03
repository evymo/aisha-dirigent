-- ============================================================================
-- Source of Truth: agent_live_sessions
-- Purpose: Universal live-presence registry for agent work sessions — one
--          upsert row per (session_id). Source-dimensioned: Claude Code CLI
--          hooks, VS Code Dirigent extension, Zed, Codex, n8n and container
--          runs all report here instead of inventing per-source registries.
--          Powers the Dirigent VS Code live panel and Mission Control
--          AgentSessionsStrip via realtime subscription.
-- Managed by: fn_upsert_agent_live_session() + fn_log_agent_session_event()
--             (SECURITY DEFINER RPCs). Event history lives in ai_trace_events
--             keyed by ai_run_id (kind='ide_session'), NOT in a parallel
--             event table — see fn_log_agent_session_event.
-- Phases:  current_phase is validated against agent_phase_catalog
--          (axis='activity') at RPC level — intentionally NO CHECK constraint
--          so AISHA can extend the phase taxonomy by seeding catalog rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_live_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       text        NOT NULL,
  -- Which surface reports this session: 'claude-code' | 'vscode' | 'zed' |
  -- 'codex' | 'n8n' | 'container' | future sources. Open text by design —
  -- a new IDE adapter must not require a schema change to appear.
  source           text        NOT NULL DEFAULT 'claude-code',
  story_id         uuid        REFERENCES public.partner_stories(id) ON DELETE SET NULL,
  user_id          uuid        REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  -- Link to agent_runs when this session was spawned by AISHA as an isolated
  -- workload (claude_cli_task containers). NULL for human-initiated sessions.
  agent_run_id     uuid        REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  -- Telemetry aggregate: the per-session ai_runs row (kind='ide_session')
  -- that ai_trace_events for this session hang off. Created lazily by
  -- fn_upsert_agent_live_session, finished via finish_ai_run on stop.
  ai_run_id        uuid        REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  branch           text,
  -- Activity-axis phase (agent_phase_catalog axis='activity'):
  -- idle | planning | tool_use | reviewing | stopped (extensible via catalog).
  current_phase    text        NOT NULL DEFAULT 'idle',
  -- Source-specific secondary axis (e.g. VS Code workPhase: routing|edge|
  -- backend|eval|streaming — agent_phase_catalog axis='pipeline'). Free text.
  phase_detail     text,
  current_task     text,
  last_tool        text,
  last_file        text,
  -- Live snapshot of sub-agents: [{label, status, started_at, ended_at}].
  -- Maintained server-side by fn_log_agent_session_event from Agent tool
  -- pre/post events (capped at 20 entries).
  subagents        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Optional client-side token estimate (e.g. extension resource tracker).
  -- Authoritative token totals come from ai_trace_events cost rollup.
  tokens_estimate  int,
  started_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_live_sessions_session_id_unique UNIQUE (session_id)
);

COMMENT ON TABLE public.agent_live_sessions IS
  'Universal live-presence registry for agent work sessions (one upsert row per session_id, source-dimensioned). Realtime-enabled UI surface; history flows to ai_trace_events via the linked ide_session ai_run.';
COMMENT ON COLUMN public.agent_live_sessions.source IS
  'Reporting surface: claude-code | vscode | zed | codex | n8n | container | …. Open text — new sources appear without schema change.';
COMMENT ON COLUMN public.agent_live_sessions.current_phase IS
  'Activity-axis phase validated against agent_phase_catalog (axis=activity) in fn_upsert_agent_live_session — no CHECK so the taxonomy stays seed-extensible.';
COMMENT ON COLUMN public.agent_live_sessions.subagents IS
  'Live sub-agent snapshot [{label, status, started_at, ended_at}] maintained from Agent tool pre/post events; capped at 20.';
COMMENT ON COLUMN public.agent_live_sessions.ai_run_id IS
  'Per-session ai_runs aggregate (kind=ide_session) — ai_trace_events history + finish_ai_run cost rollup hang off this run.';

-- Indexes live in aisha/db/sql/indexes/ (SoT separation):
--   idx_agent_live_sessions_story | _active | _source

ALTER TABLE public.agent_live_sessions ENABLE ROW LEVEL SECURITY;
