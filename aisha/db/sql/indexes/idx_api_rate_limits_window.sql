-- Index: idx_api_rate_limits_window
-- Table: api_rate_limits

CREATE INDEX idx_api_rate_limits_window ON public.api_rate_limits USING btree (window_start, window_end);
