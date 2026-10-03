-- Index: idx_payment_sessions_user_id
-- Table: payment_sessions

CREATE INDEX idx_payment_sessions_user_id ON public.payment_sessions USING btree (user_id);
