-- Index: idx_ai_runs_faithfulness
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_ai_runs_faithfulness ON public.ai_runs USING btree (faithfulness_score_estimate) WHERE (faithfulness_score_estimate IS NOT NULL);
