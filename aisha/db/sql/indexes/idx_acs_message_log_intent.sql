-- Index: idx_acs_message_log_intent

CREATE INDEX IF NOT EXISTS idx_acs_message_log_intent ON public.acs_message_log (intent_id, sent_at);
