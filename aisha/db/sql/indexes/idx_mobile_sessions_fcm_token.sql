-- Index: idx_mobile_sessions_fcm_token
-- Table: mobile_sessions

CREATE INDEX idx_mobile_sessions_fcm_token ON public.mobile_sessions USING btree (fcm_token) WHERE (fcm_token IS NOT NULL);
