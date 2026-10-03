-- Index: idx_api_rate_limits_user_endpoint_key
-- Table: api_rate_limits

CREATE UNIQUE INDEX idx_api_rate_limits_user_endpoint_key ON public.api_rate_limits USING btree (user_id, endpoint_key);
