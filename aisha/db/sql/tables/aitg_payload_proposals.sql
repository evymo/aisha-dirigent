-- ============================================================================
-- Table: aitg_payload_proposals
-- Purpose: Aisha (or any service_role caller) proposes a new adversarial
--          payload. Stays pending until admin/staff promotes via
--          aitg_approve_payload_audited (which copies into aitg_payloads with
--          active=true). Keeps the corpus growing without anon-writable
--          paths into the canonical aitg_payloads table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_payload_proposals (
  proposal_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  payload        jsonb NOT NULL,
  expected_block text NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}'::text[],
  justification  text NOT NULL CHECK (length(justification) >= 20),
  proposed_by    text NOT NULL DEFAULT 'aisha',
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by    uuid REFERENCES aisha_auth.users(id),
  reviewed_at    timestamptz,
  promoted_payload_id uuid REFERENCES public.aitg_payloads(payload_id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aitg_payload_proposals ENABLE ROW LEVEL SECURITY;
