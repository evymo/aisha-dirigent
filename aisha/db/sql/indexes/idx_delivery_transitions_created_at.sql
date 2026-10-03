-- Index: idx_delivery_transitions_created_at

CREATE INDEX idx_delivery_transitions_created_at ON public.delivery_transitions USING btree (created_at DESC);
