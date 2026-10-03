-- ============================================================================
-- Table: aitg_payloads
-- Purpose: Adversarial corpus (red-team prompts, evasion vectors, etc.).
-- RLS: SENSITIVE — only admin/staff/auditor may read. Leaking this corpus to
--      anon would arm attackers with a curated jailbreak list.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_payloads (
  payload_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  payload        jsonb NOT NULL,
  expected_block text NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}'::text[],
  source         text NOT NULL DEFAULT 'internal',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aitg_payloads ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS consecutive_passes integer NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS quarantined_at timestamp with time zone;
