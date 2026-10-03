-- Index: idx_ai_runs_kind

CREATE INDEX idx_ai_runs_kind ON public.ai_runs USING btree (kind, started_at DESC);
