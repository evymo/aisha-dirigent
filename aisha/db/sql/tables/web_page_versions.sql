-- Table: web_page_versions
-- Purpose: historie webové stránky A její koncept — obojí v jedné tabulce.
--
--   • `kind` — 'manual' (ruční uložení), 'auto' (před obnovou / šablonou),
--              'published' (každé zveřejnění) a 'draft' (KONCEPT, 2026-10-02).
--   • `updated_at` — razítko souběhu konceptu (web_page_edit_stamp); drží ho trigger.
--
-- ⛔ PROČ KONCEPT (naměřeno 2026-10-02, naměřeno na instanci): veřejný web čte `canvas_html`
-- zveřejněné stránky přímo (get_web_page_by_slug, get_published_web_partials)
-- a editor plátna ukládá 5 s po poslední změně. U zveřejněné stránky tak každý
-- rozpracovaný pokus šel na web — správkyni webu se tak „rozsypala" úvodní
-- stránka. Zrcadlí koncept novinek (news_article_versions, 2026-09-24): jeden
-- řádek `kind = 'draft'` na stránku (částečný unikátní index), ukládání
-- zveřejněné stránky píše SEM, „Zveřejnit změny" ho přelije do `web_pages`.
-- Nezveřejněná stránka koncept nepotřebuje — není vidět.
--
-- Řádek `draft` má version_number 0 a v historii se nevypisuje.

CREATE TABLE IF NOT EXISTS public.web_page_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.web_pages(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  canvas_data jsonb NOT NULL,
  canvas_html text,
  canvas_css text,
  page_settings jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES aisha_auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  label text,
  PRIMARY KEY (id)
);

-- Běžící databáze: CREATE TABLE IF NOT EXISTS sloupce nepřidá, proto výslovně.
-- Stávající verze vznikly ručním uložením nebo zveřejněním; zveřejnění nesla
-- popisek 'publish' (AdminPageEditor), automatické snímky 'auto: …'.
ALTER TABLE public.web_page_versions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';
ALTER TABLE public.web_page_versions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.web_page_versions SET kind = 'published' WHERE kind = 'manual' AND label = 'publish';
UPDATE public.web_page_versions SET kind = 'auto' WHERE kind = 'manual' AND label LIKE 'auto:%';
ALTER TABLE public.web_page_versions DROP CONSTRAINT IF EXISTS web_page_versions_kind_check;
ALTER TABLE public.web_page_versions ADD CONSTRAINT web_page_versions_kind_check
  CHECK (kind IN ('draft', 'manual', 'auto', 'published'));

COMMENT ON TABLE public.web_page_versions IS 'Historie (manual/auto/published) a koncept (draft) webové stránky. Koncept = 1 řádek na stránku.';

ALTER TABLE public.web_page_versions ENABLE ROW LEVEL SECURITY;
