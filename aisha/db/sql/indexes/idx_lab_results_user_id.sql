-- Index: idx_lab_results_user_id
-- Table: lab_results

CREATE INDEX IF NOT EXISTS idx_lab_results_user_id ON public.lab_results(user_id);
