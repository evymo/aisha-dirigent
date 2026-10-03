-- Index: idx_security_event_resolutions_resolved_by
-- Table: security_event_resolutions

CREATE INDEX IF NOT EXISTS idx_security_event_resolutions_resolved_by ON public.security_event_resolutions(resolved_by);
