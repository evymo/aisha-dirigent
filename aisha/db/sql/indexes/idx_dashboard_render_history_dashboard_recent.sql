-- Index: idx_dashboard_render_history_dashboard_recent

CREATE INDEX IF NOT EXISTS idx_dashboard_render_history_dashboard_recent
  ON public.dashboard_render_history (dashboard_slug, rendered_at DESC);
