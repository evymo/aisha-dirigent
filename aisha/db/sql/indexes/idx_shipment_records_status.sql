-- Index: idx_shipment_records_status
-- Table: shipment_records

CREATE INDEX idx_shipment_records_status ON public.shipment_records USING btree (status);
