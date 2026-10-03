-- Table: reward_claims
-- Tracks user reward claim requests for Cosmos chain fulfillment
-- Status machine: pending → fulfilled | failed
-- RLS: ENABLED (users can view own claims)

CREATE TABLE IF NOT EXISTS public.reward_claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id),
  amount bigint NOT NULL,
  denom text NOT NULL DEFAULT 'uash',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fulfilled', 'failed')),
  -- D4 (no double-fulfilment): the originating ledger row this claim deducts from.
  -- Binds each reward_claims row 1:1 to a single token_transactions entry so a
  -- replayed / duplicated outbox fulfilment can be de-duped against the source.
  -- The UNIQUE constraint (below) is what actually ENFORCES the 1:1 binding —
  -- a second claim citing the same ledger row fails with unique_violation
  -- instead of paying out twice. Nullable, so ON DELETE SET NULL and pre-D4
  -- rows stay valid (multiple NULLs are distinct under a UNIQUE constraint).
  transaction_id uuid REFERENCES public.token_transactions(id) ON DELETE SET NULL,
  tx_hash text,
  fulfilled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT reward_claims_transaction_id_key UNIQUE (transaction_id)
);

ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;
