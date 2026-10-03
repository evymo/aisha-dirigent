-- Index: idx_api_rate_limits_cleanup
-- Table: api_rate_limits

CREATE INDEX idx_api_rate_limits_cleanup ON public.api_rate_limits USING btree (window_end);
