-- Index: idx_agent_live_sessions_active
-- Partial index for the active-sessions feed (non-stopped, recent-first).

CREATE INDEX IF NOT EXISTS idx_agent_live_sessions_active
  ON public.agent_live_sessions (updated_at DESC)
  WHERE current_phase <> 'stopped';
