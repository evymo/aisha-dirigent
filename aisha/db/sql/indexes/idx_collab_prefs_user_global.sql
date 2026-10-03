-- Index: idx_collab_prefs_user_global
-- Partial unique index: enforce one global row (story_id IS NULL) per user.
-- Standard UNIQUE cannot enforce this because NULL != NULL in PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_prefs_user_global
  ON collaboration_preferences (user_id) WHERE story_id IS NULL;
