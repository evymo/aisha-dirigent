-- Index: ai_decisions lookup by run (journal queries + RLS chain).
CREATE INDEX IF NOT EXISTS idx_ai_decisions_run
  ON public.ai_decisions (run_id, created_at DESC);
