-- Index: idx_stripe_disputes_stripe_charge_id

CREATE INDEX idx_stripe_disputes_stripe_charge_id ON public.stripe_disputes USING btree (stripe_charge_id);
