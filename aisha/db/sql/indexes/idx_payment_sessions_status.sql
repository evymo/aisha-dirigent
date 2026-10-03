-- Index: idx_payment_sessions_status
-- Table: payment_sessions

CREATE INDEX idx_payment_sessions_status ON public.payment_sessions USING btree (status);
