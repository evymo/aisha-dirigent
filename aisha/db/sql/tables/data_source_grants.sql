-- =============================================================================
-- data_source_grants — ke kterým ZDROJŮM DAT má uživatel udělený přístup.
--
-- ⭐ Majitel 2026-09-28: „ingest navrhuje vazby, protistrany… ale neměl by řešit, kdo
-- k čemu má přístup; MODĚVA, Avant… to jsou zdroje dat z Money, které chceme
-- zpřístupnit". Přístup je rozhodnutí SPRÁVY u uživatele, ne výsledek ingestu:
--   `instance:<druh>/<instance>` — instance zdroje, jak ji zapsal konektor do záznamu
--                                  (např. agenda Money „money/Areál Avant Ďáblická"),
--   `cesta:<adresář ve vstupu>`  — podstrom vstupu ingestu (i podsložky),
--   `firma:<IČO>`                — smluvní dokumenty, ve kterých je firma stranou
--                                  („vazba na firmy, které vidíme v přehledu"),
--   `vstup:dokumenty`            — všechny dokumenty zpracovaného vstupu ingestu (smlouvy…),
--   `udalosti:<zdroj>`           — dvojčata, o kterých má data zdroj (twin_events.source,
--                                  např. jednotky ze sez-vyuctovani) — majitel 2026-09-28:
--                                  „všechna data, ale rozdělená po zdrojích",
--   `vse:*`                      — PLNÝ přístup ke všem datům bez výběru (majitel
--                                  2026-09-28: „možnost bez omezení… omezit chceme
--                                  zachovat"); vyhodnocuje ma_plny_pristup_k_datum.
-- Nárok vyhodnocuje li_doc_slugs_v_rozsahu přes předpočítané klíče původu
-- (li_doc_scope_keys `@instance` / `@cesta` / `@firma`); protistrany dokladů ze zdrojů čte
-- twin_ids_v_rozsahu. Přístup do SEKCE je zvlášť (surface_section_grants).
--
-- Zápis jen hr_udel_zdroj_admin (správa, audit); RLS bez politik, žádné granty.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.data_source_grants (
  user_id     uuid        NOT NULL REFERENCES aisha_auth.users (id) ON DELETE CASCADE,
  zdroj       text        NOT NULL CHECK (zdroj ~ '^(instance|cesta|firma|vstup|udalosti|vse):.+'),
  granted_by  uuid,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_source_grants_pkey PRIMARY KEY (user_id, zdroj)
);

COMMENT ON TABLE public.data_source_grants IS
  'Udělený přístup uživatele ke zdroji dat (instance:<druh>/<instance> | cesta:<adresář vstupu> | firma:<IČO> | vstup:dokumenty | udalosti:<zdroj> | vse:*). Nárok přes klíče původu v li_doc_scope_keys. Zápis jen hr_udel_zdroj_admin.';

-- Existující tabulka (nasazená bez `vse`): CHECK se v CREATE IF NOT EXISTS nezmění.
ALTER TABLE public.data_source_grants DROP CONSTRAINT IF EXISTS data_source_grants_zdroj_check;
ALTER TABLE public.data_source_grants ADD CONSTRAINT data_source_grants_zdroj_check
  CHECK (zdroj ~ '^(instance|cesta|firma|vstup|udalosti|vse):.+');

ALTER TABLE public.data_source_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_source_grants FROM PUBLIC, anon, authenticated;
