-- Index: idx_ip_anomaly_key_active

CREATE INDEX idx_ip_anomaly_key_active ON public.improvement_proposals USING btree (anomaly_key) WHERE (status = ANY (ARRAY['draft'::text, 'pending'::text, 'pending_review'::text, 'approved'::text, 'auto_approved'::text, 'in_progress'::text]));
