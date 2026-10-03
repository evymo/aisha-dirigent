-- Index: idx_lab_results_reviewed_by
-- Table: lab_results

CREATE INDEX IF NOT EXISTS idx_lab_results_reviewed_by ON public.lab_results(reviewed_by);
