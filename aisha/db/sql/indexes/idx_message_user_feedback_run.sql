-- Index: idx_message_user_feedback_run

CREATE INDEX IF NOT EXISTS idx_message_user_feedback_run ON public.message_user_feedback USING btree (ai_run_id);
