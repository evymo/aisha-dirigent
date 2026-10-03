-- Index: federated_source_sessions_jedna_aktivni
-- „Jedna aktivní relace" drží DB, ne kód (ADR-004, revize S4): na uživatele a zdroj nejvýš
-- jedna neodvolaná relace.
CREATE UNIQUE INDEX IF NOT EXISTS federated_source_sessions_jedna_aktivni
  ON public.federated_source_sessions (user_id, provider) WHERE revoked_at IS NULL;
