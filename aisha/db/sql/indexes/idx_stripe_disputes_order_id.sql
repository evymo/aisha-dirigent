-- Index: idx_stripe_disputes_order_id

CREATE INDEX idx_stripe_disputes_order_id ON public.stripe_disputes USING btree (order_id);
