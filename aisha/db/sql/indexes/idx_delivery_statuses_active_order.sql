-- Index: idx_delivery_statuses_active_order
-- Speeds up list_delivery_statuses (pipeline UI loads active statuses in
-- sort order; governance layer caches them at boot).

CREATE INDEX IF NOT EXISTS idx_delivery_statuses_active_order
  ON public.delivery_statuses (sort_order ASC)
  WHERE is_active = true;
