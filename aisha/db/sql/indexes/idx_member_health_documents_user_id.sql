-- Index: idx_member_health_documents_user_id
-- Table: member_health_documents

CREATE INDEX IF NOT EXISTS idx_member_health_documents_user_id
  ON public.member_health_documents USING btree (user_id);

-- ============================================================================
-- member_health_logs — user health log queries
-- ============================================================================
-- ============================================================================
-- partner_appointments — date-based queries for booking calendars
-- ============================================================================
