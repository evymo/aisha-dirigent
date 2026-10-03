-- Index: idx_sla_tracking_breached

CREATE INDEX IF NOT EXISTS idx_sla_tracking_breached ON public.sla_tracking USING btree (sla_breached) WHERE ((sla_breached = false) AND (first_response_at IS NULL));
