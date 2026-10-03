-- Index: idx_aitg_payload_proposals_pending
-- Extracted from tables/aitg_payload_proposals.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_payload_proposals_pending
  ON public.aitg_payload_proposals(test_id, created_at DESC)
  WHERE status = 'pending';
