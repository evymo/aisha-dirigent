-- Index: idx_alcohol_tracking_summary_user_id
-- Table: alcohol_tracking_summary

CREATE INDEX IF NOT EXISTS idx_alcohol_tracking_summary_user_id ON public.alcohol_tracking_summary(user_id);
