-- ============================================================================
-- Table: archive_tags
-- Purpose: Centralized tag management for archive documents
-- Categories: person, keyword, preparation, facility, place
-- ============================================================================

-- Create enum for tag categories if not exists
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
END
$$;

-- Create table
CREATE TABLE IF NOT EXISTS public.archive_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tag identification
  code TEXT NOT NULL,  -- Unique code for the tag (e.g., "kasparek_karel")
  category archive_tag_category NOT NULL,
  
  -- Translation key (for dynamic translations)
  name_key TEXT NOT NULL,  -- e.g., "archive.tags.person.kasparek_karel"
  
  -- Fallback display names (for cases when translation is not available)
  display_name TEXT NOT NULL,  -- Primary display name (usually in base locale)
  
  -- Metadata
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT archive_tags_code_category_unique UNIQUE (code, category)
);

-- Comments
COMMENT ON TABLE public.archive_tags IS 'Centralized tag management for archive documents with translation support';
COMMENT ON COLUMN public.archive_tags.code IS 'Unique identifier code for the tag within its category';
COMMENT ON COLUMN public.archive_tags.category IS 'Tag category: person, keyword, preparation, facility, place';
COMMENT ON COLUMN public.archive_tags.name_key IS 'Translation key for dynamic translations (e.g., archive.tags.person.kasparek_karel)';
COMMENT ON COLUMN public.archive_tags.display_name IS 'Fallback display name when translation is not available';
COMMENT ON COLUMN public.archive_tags.usage_count IS 'Number of documents using this tag (for sorting by popularity)';

-- Enable RLS
ALTER TABLE public.archive_tags ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON public.archive_tags TO anon;
GRANT SELECT ON public.archive_tags TO authenticated;

-- Note: RLS Policies are in supabase/sql/policies/archive_tags__*.sql
-- Note: Indexes are in supabase/sql/indexes/idx_archive_tags_*.sql
-- Note: Triggers are in supabase/sql/triggers/set_archive_tags_updated_at.sql
