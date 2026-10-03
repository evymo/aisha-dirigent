-- Table: shipment_settings
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS shipment_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text ,
  value jsonb ,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  setting_key text NOT NULL,
  setting_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT shipment_settings_key_key UNIQUE (key),
  CONSTRAINT shipment_settings_setting_key_key UNIQUE (setting_key),
  CONSTRAINT shipment_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE shipment_settings ENABLE ROW LEVEL SECURITY;
