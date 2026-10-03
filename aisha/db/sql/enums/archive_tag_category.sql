-- Enum: archive_tag_category

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'archive_tag_category') THEN
    CREATE TYPE archive_tag_category AS ENUM (
      'person',
  'keyword',
  'preparation',
  'facility',
  'place'
    );
  END IF;
END $$;
