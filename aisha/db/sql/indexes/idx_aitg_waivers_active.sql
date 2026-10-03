-- Index: idx_aitg_waivers_active
-- Extracted from tables/aitg_waivers.sql (SQL source separation policy)
--
-- Was previously declared as:
--   WHERE expires_at > now()
-- but PostgreSQL rejects non-IMMUTABLE functions in index predicates
-- ("functions in index predicate must be marked IMMUTABLE"). `now()` is
-- STABLE so the partial-index plan was invalid baseline syntax.
--
-- The compromise: index ALL rows on (test_id, expires_at). Queries that
-- filter on `expires_at > now()` still benefit from index scans on
-- (test_id, expires_at) — the planner uses the range bound after the
-- equality match on test_id. Costs slightly more storage but removes the
-- IMMUTABLE constraint.

CREATE INDEX IF NOT EXISTS idx_aitg_waivers_active ON public.aitg_waivers(test_id, expires_at);
