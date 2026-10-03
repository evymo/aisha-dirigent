-- Index: idx_agent_live_sessions_source
-- Source-dimensioned recent-activity lookups (per CLI/IDE/spawned source).

CREATE INDEX IF NOT EXISTS idx_agent_live_sessions_source
  ON public.agent_live_sessions (source, updated_at DESC);
