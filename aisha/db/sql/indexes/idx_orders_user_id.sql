-- Index: idx_orders_user_id
-- Table: orders

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);
