-- Index: idx_lab_results_document_id
-- Table: lab_results

CREATE INDEX IF NOT EXISTS idx_lab_results_document_id
ON public.lab_results USING btree (document_id)
WHERE (document_id IS NOT NULL);
