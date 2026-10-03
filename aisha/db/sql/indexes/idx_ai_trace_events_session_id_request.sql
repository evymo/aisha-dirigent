-- Index: idx_ai_trace_events_session_id_request
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_ai_trace_events_session_id_request ON public.ai_trace_events USING btree (((request_summary ->> 'session_id'::text))) WHERE ((request_summary ->> 'session_id'::text) IS NOT NULL);
