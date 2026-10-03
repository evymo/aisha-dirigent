-- Enum: consent_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_type') THEN
    CREATE TYPE consent_type AS ENUM (
      'data_processing',
  'observation',
  'operational_trial',
  'wearables',
  'marketing',
  'informed_consent'
    );
  END IF;
END $$;

-- Values: data_processing, observation, operational_trial, wearables, marketing, informed_consent
