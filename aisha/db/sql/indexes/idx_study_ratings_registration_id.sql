-- Index: idx_study_ratings_registration_id
-- Table: study_ratings

CREATE INDEX IF NOT EXISTS idx_study_ratings_registration_id ON public.study_ratings(registration_id);
