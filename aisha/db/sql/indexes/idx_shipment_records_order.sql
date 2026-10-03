-- Index: idx_shipment_records_order
-- Table: shipment_records

CREATE INDEX idx_shipment_records_order ON public.shipment_records USING btree (order_id);
