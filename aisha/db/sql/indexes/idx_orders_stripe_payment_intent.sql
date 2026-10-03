-- Index: idx_orders_stripe_payment_intent
-- Table: orders

CREATE INDEX idx_orders_stripe_payment_intent ON public.orders USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);
