-- Index: idx_dashboard_render_history_hash

CREATE INDEX IF NOT EXISTS idx_dashboard_render_history_hash
  ON public.dashboard_render_history (dashboard_slug, content_hash);
