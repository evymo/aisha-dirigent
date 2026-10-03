-- Index: idx_psr_flow_node_recorded

CREATE INDEX idx_psr_flow_node_recorded ON public.production_sensor_readings USING btree (flow_node_id, recorded_at DESC) WHERE (flow_node_id IS NOT NULL);
