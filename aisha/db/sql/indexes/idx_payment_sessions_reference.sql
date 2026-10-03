-- Index: idx_payment_sessions_reference
-- Table: payment_sessions

CREATE INDEX idx_payment_sessions_reference ON public.payment_sessions USING btree (reference_type, reference_id);
