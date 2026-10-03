-- Index: idx_shipment_records_month
-- Table: shipment_records

CREATE INDEX idx_shipment_records_month ON public.shipment_records USING btree (distribution_month);
