-- Table: partner_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general'::text,
  is_active bool NOT NULL DEFAULT true,
  is_default bool NOT NULL DEFAULT false,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT partner_templates_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE
);

ALTER TABLE partner_templates ENABLE ROW LEVEL SECURITY;
