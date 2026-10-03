-- Index: idx_web_page_versions_page_id
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_web_page_versions_page_id ON public.web_page_versions USING btree (page_id, version_number DESC);
