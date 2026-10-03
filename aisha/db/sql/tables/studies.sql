-- Table: studies
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS studies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  title text,
  slug text,
  description text,
  invitation_permission text DEFAULT 'consultant'::text,
  study_type study_type NOT NULL,
  status study_status NOT NULL DEFAULT 'screening'::study_status,
  is_umbrella bool DEFAULT false,
  is_active bool DEFAULT true,
  is_blinded bool DEFAULT false,
  target_registration int4,
  current_registration int4 DEFAULT 0,
  min_participants int4,
  max_participants int4,
  funding_goal numeric,
  current_funding numeric DEFAULT 0,
  funding_deadline timestamptz,
  funding_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  duration_weeks int4,
  target_condition text,
  products text[],
  protocol_url text,
  informed_consent_version text,
  informed_consent_special_provisions text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  parent_study_id uuid,
  name_key text,
  description_key text,
  title_key text,
  PRIMARY KEY (id),
  CONSTRAINT studies_parent_study_id_fkey FOREIGN KEY (parent_study_id) REFERENCES studies(id)
);

ALTER TABLE studies ENABLE ROW LEVEL SECURITY;

-- Grants: public study data
GRANT SELECT ON studies TO anon;
GRANT SELECT ON studies TO authenticated;
GRANT ALL ON studies TO service_role;
