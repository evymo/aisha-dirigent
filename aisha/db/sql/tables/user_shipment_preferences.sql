-- Table: user_shipment_preferences
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_shipment_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  preferred_carrier text,
  packeta_point_id text,
  delivery_instructions text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT user_shipment_preferences_user_id_key UNIQUE (user_id),
  CONSTRAINT user_shipment_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_shipment_preferences ENABLE ROW LEVEL SECURITY;
