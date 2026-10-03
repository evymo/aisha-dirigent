-- Type: split_recipient_type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'split_recipient_type') THEN
    CREATE TYPE split_recipient_type AS ENUM (
      'specialist', 'knowledge_contributor', 'platform'
    );
  END IF;
END $$;
