-- Index: idx_consultation_sessions_status

CREATE INDEX IF NOT EXISTS idx_consultation_sessions_status ON public.consultation_sessions USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'ringing'::text, 'active'::text]));
