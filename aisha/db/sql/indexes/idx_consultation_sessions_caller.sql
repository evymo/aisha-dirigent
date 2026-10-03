-- Index: idx_consultation_sessions_caller

CREATE INDEX IF NOT EXISTS idx_consultation_sessions_caller ON public.consultation_sessions USING btree (caller_id);
