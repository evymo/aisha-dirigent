-- Index: federated_source_sessions_fronta_odhlaseni
-- Fronta odhlášení u zdroje pro plánovač brokeru (ADR-004, bod 6).
CREATE INDEX IF NOT EXISTS federated_source_sessions_fronta_odhlaseni
  ON public.federated_source_sessions (logout_next_at) WHERE revoked_at IS NOT NULL AND logout_done_at IS NULL;
