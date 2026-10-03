-- Index: uq_twin_external_refs_active_owner
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Invariant: klíč zdroje má v rámci DRUHU ENTITY nejvýš JEDNOHO aktivního
-- potvrzeného vlastníka (Dallas čip nemůže patřit dvěma lidem naráz); předání
-- = valid_to + nový řádek.
--
-- ⭐ 2026-09-27: + entity_type. Bez druhu entity kolidoval zdroj, který čísluje
-- dva druhy objektů zvlášť (vozidlo 5 × osoba 5 — T-cars, Eurowag): potvrzené
-- vozidlo „zabralo" klíč osoby. Týž klíč teď smí mít jedno vozidlo A jedna
-- osoba; v rámci druhu platí pojistka dál.
--
-- Výměna na živé DB bez okna bez pojistky (a jedním vytvořením — 1 soubor =
-- 1 index): starý index (bez druhu) se jen PŘEJMENUJE a hlídá dál, vedle něj
-- vznikne nový pod pravým jménem (nová definice je volnější, stará data ji
-- splní vždy), teprve pak se starý zahodí. Na čisté DB vznikne rovnou.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'uq_twin_external_refs_active_owner'
                AND indexdef NOT LIKE '%entity_type%') THEN
    ALTER INDEX public.uq_twin_external_refs_active_owner RENAME TO uq_twin_external_refs_active_owner_bez_druhu;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_external_refs_active_owner
  ON public.twin_external_refs (source, source_key, ref_kind, entity_type)
  WHERE state = 'confirmed' AND valid_to IS NULL;

DROP INDEX IF EXISTS public.uq_twin_external_refs_active_owner_bez_druhu;
