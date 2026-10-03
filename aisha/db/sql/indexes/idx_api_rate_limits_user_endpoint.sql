-- Index: idx_api_rate_limits_user_endpoint
-- Table: api_rate_limits

CREATE INDEX idx_api_rate_limits_user_endpoint ON public.api_rate_limits USING btree (user_id, endpoint_key);
