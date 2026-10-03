-- Table: news_articles
--
-- A news article is a CONTENT NODE — same model as web_pages. Besides the i18n
-- title/content/excerpt keys it carries a GrapesJS canvas (canvas_data +
-- canvas_html + canvas_css) so admins author articles in the SAME editor as
-- pages and the article hosts runtime blocks. content_key stays for plain text.
--
-- 2026-09-24: ohnisko a přiblížení titulního obrázku (image_focus_x/y, image_zoom).
-- Obrázek se NIKDY nemění — ukládají se tři čísla a každý blok (karta 16:9, úzký
-- pruh, mobil) si výřez spočítá při doručení (storage-auth → imgproxy). Řádky
-- z importu mají výchozí střed a bez přiblížení, tedy přesně dnešní `object-cover`.

CREATE TABLE IF NOT EXISTS public.news_articles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  title_key text NOT NULL,
  content_key text NOT NULL,
  excerpt_key text,
  image_url text,
  image_focus_x numeric(4,3) DEFAULT 0.5 NOT NULL,
  image_focus_y numeric(4,3) DEFAULT 0.5 NOT NULL,
  image_zoom numeric(4,2) DEFAULT 1 NOT NULL,
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  is_published boolean DEFAULT false NOT NULL,
  published_at timestamp with time zone,
  sort_order integer DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

-- Běžící databáze: CREATE TABLE IF NOT EXISTS sloupce nepřidá, proto výslovně.
ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS image_focus_x numeric(4,3) DEFAULT 0.5 NOT NULL;
ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS image_focus_y numeric(4,3) DEFAULT 0.5 NOT NULL;
ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS image_zoom numeric(4,2) DEFAULT 1 NOT NULL;
ALTER TABLE public.news_articles DROP CONSTRAINT IF EXISTS news_articles_image_focus_check;
ALTER TABLE public.news_articles ADD CONSTRAINT news_articles_image_focus_check
  CHECK (image_focus_x >= 0 AND image_focus_x <= 1 AND image_focus_y >= 0 AND image_focus_y <= 1
         AND image_zoom >= 1 AND image_zoom <= 4);

COMMENT ON COLUMN public.news_articles.canvas_data IS 'GrapesJS ProjectData JSON — same model as web_pages.';
COMMENT ON COLUMN public.news_articles.canvas_html IS 'Rendered HTML from GrapesJS (carries data-runtime-block placeholders).';
COMMENT ON COLUMN public.news_articles.canvas_css IS 'Scoped CSS from GrapesJS.';
COMMENT ON COLUMN public.news_articles.tags IS 'Free-form tags powering the dynamic archive/blog filter (get_news_tags / get_published_news_articles_filtered).';
COMMENT ON COLUMN public.news_articles.image_focus_x IS 'Ohnisko titulního obrázku, 0–1 zleva. Obrázek se nemění; výřez počítá doručení.';
COMMENT ON COLUMN public.news_articles.image_focus_y IS 'Ohnisko titulního obrázku, 0–1 shora.';
COMMENT ON COLUMN public.news_articles.image_zoom IS 'Přiblížení výřezu 1–4 (1 = celý obrázek).';

ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
