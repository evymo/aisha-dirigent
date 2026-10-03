-- Index: idx_ai_proactive_runs_otevrene
-- Dohnání (claim_pending_proactive_runs: pending podle stáří) i vracení zaseknutých
-- (requeue_stale_proactive_runs: running podle started_at) čtou jen OTEVŘENÉ běhy.
-- Těch je proti historii zlomek — partial index drží tik executoru nezávislý na tom,
-- kolik běhů se kdy dokončilo.
CREATE INDEX IF NOT EXISTS idx_ai_proactive_runs_otevrene
  ON public.ai_proactive_runs (status, created_at)
  WHERE status IN ('pending', 'running');
