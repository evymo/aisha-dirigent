-- Index: federated_flow_nonces_expires_at
-- Úklid prošlých nonce přihlašovacího toku (federated_flow_nonces_cleanup).
CREATE INDEX IF NOT EXISTS federated_flow_nonces_expires_at
  ON public.federated_flow_nonces (expires_at);
