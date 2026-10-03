-- Index: idx_aitg_payloads_test
-- Extracted from tables/aitg_payloads.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_payloads_test ON public.aitg_payloads(test_id, active);
