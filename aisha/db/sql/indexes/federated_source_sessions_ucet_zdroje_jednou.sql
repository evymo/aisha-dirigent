-- Index: federated_source_sessions_ucet_zdroje_jednou
-- Jeden účet u zdroje (provider_id) živě jen u jednoho uživatele aishy (ADR-004, B13).
CREATE UNIQUE INDEX IF NOT EXISTS federated_source_sessions_ucet_zdroje_jednou
  ON public.federated_source_sessions (provider, provider_id) WHERE revoked_at IS NULL;
