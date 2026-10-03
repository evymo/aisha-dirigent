-- Index: idx_order_items_order_id
-- Table: order_items

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);
