-- Table: partner_certifications
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_certifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.partner_profiles ON DELETE SET NULL,
  certification_type text,
  issued_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  certificate_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  score int4 NOT NULL DEFAULT 0,
  passed bool NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  PRIMARY KEY (id)
);

ALTER TABLE partner_certifications ENABLE ROW LEVEL SECURITY;
