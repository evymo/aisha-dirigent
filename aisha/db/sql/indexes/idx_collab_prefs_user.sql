-- Index: idx_collab_prefs_user
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_collab_prefs_user ON public.collaboration_preferences (user_id);
