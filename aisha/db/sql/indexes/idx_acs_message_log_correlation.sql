-- Index: idx_acs_message_log_correlation

CREATE INDEX IF NOT EXISTS idx_acs_message_log_correlation ON public.acs_message_log (correlation_id, sent_at);
