-- Index: idx_data_sharing_consents_user_id
-- Table: data_sharing_consents

CREATE INDEX IF NOT EXISTS idx_data_sharing_consents_user_id
  ON public.data_sharing_consents USING btree (user_id);

-- ============================================================================
-- member_health_documents — user document access
-- ============================================================================
