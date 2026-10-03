-- Index: idx_mobile_sessions_user_fcm
-- Table: mobile_sessions

CREATE INDEX idx_mobile_sessions_user_fcm ON public.mobile_sessions USING btree (user_id) WHERE (fcm_token IS NOT NULL);
