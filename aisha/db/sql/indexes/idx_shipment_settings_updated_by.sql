-- Index: idx_shipment_settings_updated_by
-- Table: shipment_settings

CREATE INDEX IF NOT EXISTS idx_shipment_settings_updated_by ON public.shipment_settings(updated_by);
