-- Index: source_catalog_rows_kind_occurred_idx
-- Source of truth pair: aisha/db/sql/tables/source_catalog_rows.sql
--
-- Pohledy instance čtou jeden druh katalogu v čase — (zdroj, druh, osa).
-- IF NOT EXISTS: heals ho přehrává i na běžící instanci.

CREATE INDEX IF NOT EXISTS source_catalog_rows_kind_occurred_idx
  ON public.source_catalog_rows USING btree (source_slug, kind, occurred_at);
