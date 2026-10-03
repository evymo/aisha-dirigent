-- Table: source_catalog_rows
-- RLS: ENABLED
--
-- Katalogy zdroje — celé množiny záznamů federovaného zdroje (nadcházející
-- akce, místa, členové, denní snímky KPI), jak je adaptér vydal přes
-- listCatalog() a svc-source-broker v taktu přelil přes
-- audience_sync_source_catalog.
--
-- PROČ TO EXISTUJE: plocha extranetu čte jen tabulky jádra, nikdy živé routy
-- brokeru (naměřeno 2026-09-15: KPI komunity a detail člena existovaly jen jako
-- živé /source/* routy pro Appsmith, blok na ně nedosáhl). Co má být na ploše,
-- musí ležet tady.
--
-- Platforma nezná jména věcí zdroje: `kind` je slug instance, `fields` jsou
-- skaláry v tvaru, jaký vydal adaptér. Typované sloupce a prezentaci (booleany
-- jako text — maska tabulky boolean nepřipouští) dělají POHLEDY instance.
--
-- `occurred_at` = časová osa katalogu (akce: začátek konání; snímek KPI: den;
-- člen: vstup), aby pohledy uměly řadit a filtrovat bez rozbalování jsonb.
-- `first_seen_at` se při dalším taktu NEPŘEPISUJE — „nové od posledně" je
-- odvoditelné bez historie změn.
CREATE TABLE IF NOT EXISTS public.source_catalog_rows (
  source_slug   text NOT NULL,
  kind          text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id   text NOT NULL CHECK (external_id <> ''),
  occurred_at   timestamp with time zone,
  fields        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  synced_at     timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (source_slug, kind, external_id)
);

ALTER TABLE public.source_catalog_rows ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.source_catalog_rows IS
  'Source catalogs (whole record sets: events, venues, members, KPI snapshots) synced by svc-source-broker from the adapter listCatalog(). Read via instance audience_admin_*_v views; never edited by hand.';
