-- Table: symptom_catalog
-- Centralized symptom catalog managed by admin
-- Translations via translations table (namespace=symptom_catalog)
-- RLS: ENABLED
-- Created: 2026-02-07

CREATE TABLE IF NOT EXISTS public.symptom_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'general',
  icon text NOT NULL DEFAULT '🩺',
  color text NOT NULL DEFAULT '#ef4444',
  default_severity_scale integer NOT NULL DEFAULT 5,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.symptom_catalog ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.symptom_catalog IS 'Centralized symptom catalog managed by admin. Translations via translations table (namespace=symptom_catalog).';
COMMENT ON COLUMN public.symptom_catalog.code IS 'Unique code identifier (e.g., fatigue, joint-pain)';
COMMENT ON COLUMN public.symptom_catalog.category IS 'Category (general, neurological, digestive, etc.)';
COMMENT ON COLUMN public.symptom_catalog.icon IS 'Emoji icon for display';
COMMENT ON COLUMN public.symptom_catalog.color IS 'Color code for display';
COMMENT ON COLUMN public.symptom_catalog.default_severity_scale IS 'Default severity scale (5 or 10 point)';
COMMENT ON COLUMN public.symptom_catalog.sort_order IS 'Display sort order';
COMMENT ON COLUMN public.symptom_catalog.is_active IS 'Whether this catalog entry is active';
