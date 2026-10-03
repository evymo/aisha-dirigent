-- Table: supported_languages
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS supported_languages (
  code text NOT NULL,
  name_native text NOT NULL,
  name_key text,
  is_active bool DEFAULT true,
  is_default bool DEFAULT false,
  sort_order int4 DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (code)
);

ALTER TABLE supported_languages ENABLE ROW LEVEL SECURITY;
