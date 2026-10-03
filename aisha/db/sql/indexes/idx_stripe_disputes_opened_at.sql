-- Index: idx_stripe_disputes_opened_at

CREATE INDEX idx_stripe_disputes_opened_at ON public.stripe_disputes USING btree (opened_at DESC);
