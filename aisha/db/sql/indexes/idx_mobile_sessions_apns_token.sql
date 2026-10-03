-- Index: idx_mobile_sessions_apns_token
-- Table: mobile_sessions

CREATE INDEX idx_mobile_sessions_apns_token ON public.mobile_sessions USING btree (apns_token) WHERE (apns_token IS NOT NULL);
