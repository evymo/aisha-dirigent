-- Table: web_pages
-- Description: GrapeJS page builder web pages with i18n key references
-- RLS: ENABLED
-- Created: 2026-04-11

CREATE TABLE IF NOT EXISTS public.web_pages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title_key text NOT NULL,
  description_key text,
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  status text NOT NULL DEFAULT 'draft',
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  og_image_url text,
  page_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE SET NULL,
  branding_profile_id uuid REFERENCES public.branding_profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT web_pages_status_check CHECK (status IN ('draft', 'published'))
);

ALTER TABLE public.web_pages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.web_pages IS 'GrapeJS page builder web pages with i18n key references';
COMMENT ON COLUMN public.web_pages.slug IS 'URL slug (e.g. "index", "faq"). "index" = homepage';
COMMENT ON COLUMN public.web_pages.title_key IS 'i18n key for page <title> (namespace: web)';
COMMENT ON COLUMN public.web_pages.description_key IS 'i18n key for page meta description (namespace: web)';
COMMENT ON COLUMN public.web_pages.canvas_data IS 'GrapesJS ProjectData JSON (full editor state)';
COMMENT ON COLUMN public.web_pages.canvas_html IS 'Rendered HTML from GrapesJS';
COMMENT ON COLUMN public.web_pages.canvas_css IS 'Scoped CSS from GrapesJS';
COMMENT ON COLUMN public.web_pages.status IS 'draft = admin only, published = public';
COMMENT ON COLUMN public.web_pages.sort_order IS 'Display order in admin list (lower = first)';
COMMENT ON COLUMN public.web_pages.is_active IS 'Soft delete flag';
COMMENT ON COLUMN public.web_pages.og_image_url IS 'Open Graph image URL for social sharing';
COMMENT ON COLUMN public.web_pages.page_settings IS 'Page-level visual settings (background, font override, custom CSS vars)';
COMMENT ON COLUMN public.web_pages.story_id IS 'Owning story for the last applied artifact (NULL = stack-default seeded at bootstrap)';
COMMENT ON COLUMN public.web_pages.branding_profile_id IS 'Owning brand/site (branding_profiles.id). NULL = global stack-default page served to any hostname without a brand-specific override.';

GRANT SELECT ON public.web_pages TO anon;
GRANT SELECT ON public.web_pages TO authenticated;
GRANT ALL ON public.web_pages TO service_role;
