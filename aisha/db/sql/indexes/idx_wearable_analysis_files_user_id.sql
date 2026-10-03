-- Index: idx_wearable_analysis_files_user_id
-- Table: wearable_analysis_files

CREATE INDEX IF NOT EXISTS idx_wearable_analysis_files_user_id ON public.wearable_analysis_files(user_id);
