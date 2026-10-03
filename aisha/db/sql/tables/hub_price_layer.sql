-- ============================================================================
-- Source of Truth: hub_price_layer
-- Popis: Connector Hub — "hamburger" price layers (conditional, stacked). AISHA
--        composes/simulates; the result is applied INTO the target per tenant.
--        Spravováno: admin/staff (hub_upsert_price_layer) + AISHA (proactive).
-- Pár: aisha/db/migrations/20260627150000_hub_price_layers.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_price_layer (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  layer_kind  text        NOT NULL DEFAULT 'surcharge',
  value_kind  text        NOT NULL DEFAULT 'percent',
  value       numeric     NOT NULL DEFAULT 0,
  condition   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- How this layer PROPAGATES into the commerce target (which already owns pricing):
  --   'rule'      → a target-native product_collection_price rule (amount/percentage),
  --                 set + refresh_prices on the target collection AS the federated user;
  --   'simulated' → non-native in the target (date/quantity/customer-attribute) → AISHA
  --                 simulates it hub-side and pushes the PRE-CALCULATED price (specific_price_put).
  target_kind              text NOT NULL DEFAULT 'rule'
                              CONSTRAINT hub_price_layer_target_kind_chk
                              CHECK (target_kind IN ('rule', 'simulated')),
  target_price_type        text,   -- the target price_type the rule sets, e.g. 'sell' — null for simulated
  target_source_price_type text,   -- the target source price_type, e.g. 'purchase' — null for simulated
  sort_order  integer     NOT NULL DEFAULT 100,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hub_price_layer IS 'Connector Hub: hamburger price layers (conditional, stacked). AISHA composes; result applied into the target per tenant.';

ALTER TABLE public.hub_price_layer ENABLE ROW LEVEL SECURITY;
