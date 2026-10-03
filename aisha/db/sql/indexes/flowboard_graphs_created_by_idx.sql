-- Index: flowboard_graphs_created_by_idx

CREATE INDEX IF NOT EXISTS flowboard_graphs_created_by_idx ON public.flowboard_graphs USING btree (created_by);
