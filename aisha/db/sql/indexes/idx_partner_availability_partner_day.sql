-- Index: idx_partner_availability_partner_day
-- Table: partner_availability

CREATE INDEX IF NOT EXISTS idx_partner_availability_partner_day
  ON public.partner_availability USING btree (partner_id, day_of_week)
  WHERE is_available = true;

-- ============================================================================
-- study_contributions — funding calculations & admin views
-- ============================================================================
