-- Table: news_article_versions
-- Purpose: historie článku novinek A jeho koncept — obě v jedné tabulce (2026-09-24).
--
-- Zrcadlí `web_page_versions`, ale nese navíc:
--   • `kind`   — 'manual' (ruční uložení), 'auto' (před obnovou), 'published'
--                (každé zveřejnění; nikdy se nemaže) a 'draft' (KONCEPT).
--   • `fields` — hlavička článku: obrázek, ohnisko, přiblížení, štítky a TEXTY
--                (titulek/perex/tělo po jazycích). Texty žijí v `translations`,
--                takže bez snímku by obnova verze vrátila plátno, ale ne titulek.
--
-- ⛔ PROČ KONCEPT (naměřeno 2026-09-24): veřejná stránka čte `canvas_html`
-- článku přímo (`get_news_article_by_slug`) a editor plátna ukládá 5 s po
-- poslední změně. U zveřejněného článku tedy každá nedopsaná věta šla na web.
-- Koncept je jeden řádek `kind = 'draft'` na článek (částečný unikátní index):
-- ukládání zveřejněného článku píše SEM, „Zveřejnit změny" ho přelije do
-- `news_articles`. Nezveřejněný článek koncept nepotřebuje — není vidět.
--
-- Řádek `draft` má version_number 0 a v historii se nevypisuje.

CREATE TABLE IF NOT EXISTS public.news_article_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.news_articles(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'manual',
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  label text,
  created_by uuid REFERENCES aisha_auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT news_article_versions_kind_check CHECK (kind IN ('draft', 'manual', 'auto', 'published'))
);

COMMENT ON TABLE public.news_article_versions IS 'Historie (manual/auto/published) a koncept (draft) článku novinek. Koncept = 1 řádek na článek.';
COMMENT ON COLUMN public.news_article_versions.fields IS 'Hlavička: {image_url, image_focus_x, image_focus_y, image_zoom, tags, texts:{locale:{title,excerpt,content}}}.';

ALTER TABLE public.news_article_versions ENABLE ROW LEVEL SECURITY;
