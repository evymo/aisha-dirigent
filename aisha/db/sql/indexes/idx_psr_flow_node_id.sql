-- Index: idx_psr_flow_node_id

CREATE INDEX idx_psr_flow_node_id ON public.production_sensor_readings USING btree (flow_node_id) WHERE (flow_node_id IS NOT NULL);
