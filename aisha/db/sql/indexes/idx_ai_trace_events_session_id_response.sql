-- Index: idx_ai_trace_events_session_id_response
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_ai_trace_events_session_id_response ON public.ai_trace_events USING btree (((response_summary ->> 'session_id'::text))) WHERE ((response_summary ->> 'session_id'::text) IS NOT NULL);
