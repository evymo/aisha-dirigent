-- Index: idx_acs_message_log_logged_at

CREATE INDEX IF NOT EXISTS idx_acs_message_log_logged_at ON public.acs_message_log (logged_at);
