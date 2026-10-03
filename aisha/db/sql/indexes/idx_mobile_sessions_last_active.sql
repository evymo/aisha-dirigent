-- Index: idx_mobile_sessions_last_active
-- Table: mobile_sessions

CREATE INDEX idx_mobile_sessions_last_active ON public.mobile_sessions USING btree (last_active_at DESC);
