-- Table: study_consultants
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_consultants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  role consultant_role_enum NOT NULL DEFAULT 'consultant'::consultant_role_enum,
  status consultant_status_enum NOT NULL DEFAULT 'pending'::consultant_status_enum,
  max_participants int4,
  notes text,
  applied_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT study_consultants_study_id_partner_id_key UNIQUE (partner_id, study_id),
  CONSTRAINT study_consultants_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT study_consultants_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT study_consultants_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE study_consultants ENABLE ROW LEVEL SECURITY;

-- Grants: public consultant directory
GRANT SELECT ON study_consultants TO anon;
GRANT SELECT, INSERT, UPDATE ON study_consultants TO authenticated;
GRANT ALL ON study_consultants TO service_role;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.study_consultants ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'study'::text;
