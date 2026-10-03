-- Index: idx_orders_status
-- Table: orders

CREATE INDEX idx_orders_status ON public.orders USING btree (status);
