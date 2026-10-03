-- Index: idx_hub_reprice_pending

CREATE INDEX IF NOT EXISTS idx_hub_reprice_pending ON public.hub_reprice_proposal (status, created_at DESC) WHERE status = 'pending';
