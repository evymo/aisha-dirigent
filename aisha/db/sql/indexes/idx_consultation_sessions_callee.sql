-- Index: idx_consultation_sessions_callee

CREATE INDEX IF NOT EXISTS idx_consultation_sessions_callee ON public.consultation_sessions USING btree (callee_id);
