-- Index: idx_acs_pending_effects_state

CREATE INDEX IF NOT EXISTS idx_acs_pending_effects_state ON public.acs_pending_effects (state, expires_at);
