-- Index: idx_profiles_stripe_customer
-- Table: profiles

CREATE INDEX idx_profiles_stripe_customer ON public.profiles USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);
