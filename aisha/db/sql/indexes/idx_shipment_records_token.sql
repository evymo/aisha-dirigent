-- Index: idx_shipment_records_token
-- Table: shipment_records

CREATE INDEX idx_shipment_records_token ON public.shipment_records USING btree (member_token);
