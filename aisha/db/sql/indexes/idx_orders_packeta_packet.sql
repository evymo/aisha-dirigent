-- Index: idx_orders_packeta_packet
-- Table: orders

CREATE INDEX idx_orders_packeta_packet ON public.orders USING btree (packeta_packet_id) WHERE (packeta_packet_id IS NOT NULL);
