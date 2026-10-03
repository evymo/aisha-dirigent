-- ============================================================================
-- Source of Truth: federated_flow_nonces
-- Popis: Použitá nonce stavu přihlašovacího toku begin → pokracuj (ADR-004, bod 4).
--
-- Stav mezi kroky nosí klient (AEAD klíčem brokeru). Aby byl JEDNORÁZOVÝ i při víc
-- replikách brokeru, evidence použitých nonce je tady — ne v paměti procesu, která
-- by se s replikami násobila. Prošlá nonce maže plánovač brokeru
-- (`federated_flow_nonces_cleanup`).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.federated_flow_nonces (
  nonce       text PRIMARY KEY,
  -- CASCADE je tu správně (na rozdíl od trezoru relací): za nonce žádný token není,
  -- se smazaným uživatelem ztrácí smysl i jeho rozběhnutý přihlašovací tok.
  user_id     uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT federated_flow_nonces_nonce_delka CHECK (length(nonce) >= 16)
);

COMMENT ON TABLE public.federated_flow_nonces IS
  'Použitá nonce stavu přihlašovacího toku federace (jednorázovost napříč replikami brokeru). Jen servisní role.';

ALTER TABLE public.federated_flow_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.federated_flow_nonces FROM PUBLIC, anon, authenticated;
