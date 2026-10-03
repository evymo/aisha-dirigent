-- Index: stripe_disputes_stripe_dispute_id_key

CREATE UNIQUE INDEX stripe_disputes_stripe_dispute_id_key ON public.stripe_disputes USING btree (stripe_dispute_id);
