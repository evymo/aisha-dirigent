-- Table: security_event_resolutions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS security_event_resolutions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid ,
  audit_journal_id uuid REFERENCES public.audit_journal ON DELETE SET NULL,
  resolved_by uuid,
  resolution_type text ,
  resolution_notes text,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  audit_event_id uuid ,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT security_event_resolutions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE security_event_resolutions ENABLE ROW LEVEL SECURITY;
