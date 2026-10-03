-- Index: idx_partner_appointments_status
-- Table: partner_appointments

CREATE INDEX IF NOT EXISTS idx_partner_appointments_status
  ON public.partner_appointments USING btree (status);

-- ============================================================================
-- translations — frequently queried by namespace+locale+key
-- ============================================================================
