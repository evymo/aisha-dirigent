-- Index: idx_message_user_feedback_rating

CREATE INDEX IF NOT EXISTS idx_message_user_feedback_rating ON public.message_user_feedback USING btree (rating, created_at DESC);
