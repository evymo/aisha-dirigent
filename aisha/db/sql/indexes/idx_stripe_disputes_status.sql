-- Index: idx_stripe_disputes_status

CREATE INDEX idx_stripe_disputes_status ON public.stripe_disputes USING btree (status);
