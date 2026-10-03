-- ============================================================================
-- Bezpečnostní oprava 2026-07-31: `migration_log_dump` smí být ČITELNÁ,
-- ne ZAPISOVATELNÁ přihlášeným uživatelem.
--
-- ZMĚŘENO NA PRODUKCI:
--   RLS: vypnutá · policies: 0
--   granty: anon SELECT · authenticated SELECT, INSERT, UPDATE, DELETE
--   obsah: 53 řádků (52 ok, 1 error), nejdelší výstup 29 997 znaků
--
-- ČTENÍ PRO `anon` SE NECHÁVÁ — je to ZÁMĚRNÝ kanál, ne přehlédnutí:
--   scripts/aisha-cold-start.sh:3199 si přes VEŘEJNÉ API ověřuje stav migrace
--   (`GET /rest/v1/migration_log_dump?select=id&order=id.desc&limit=1`)
--   ve chvíli, kdy ještě žádné přihlašovací údaje neexistují. Hlídá to brána
--   instance-data-provisioning („keeps temp passwords OUT of the anon-readable
--   migration_log_dump"). Měřením ověřeno, že brána drží: v celém obsahu je
--   0 přiřazených hodnot ke klíči, 0 řetězců tvaru JWT, 0 privátních klíčů —
--   slovo `token`/`password` se vyskytuje jen jako NÁZEV ve výpisu DDL.
--   Pozor na měřidlo: prostý `output ~* 'password|token'` dá 52/53 a vypadá
--   jako poplach; teprve rozlišení SLOVO × HODNOTA ukáže, že únik to není.
--
-- ⛔ CO SE ODEBÍRÁ: zápis. `authenticated` měl INSERT + UPDATE + DELETE
--   (ověřeno `has_table_privilege` pod tou rolí: t/t/t). Nic přes tuhle roli
--   nezapisuje — zapisovatelem je migrační běh (service_role / aisha_admin).
--   Kterýkoli přihlášený uživatel tedy mohl auditní stopu migrací přepsat
--   nebo smazat, případně do ní vložit vlastní obsah pro toho, kdo ji čte.
--   Stopa, kterou smí měnit ten, koho zaznamenává, není stopa.
-- ============================================================================

-- ⚠️ TABULKA NEMUSÍ EXISTOVAT — a to je tu podstatné. `migration_log_dump` NENÍ
-- v SoT: zakládá si ji až migrační běh. Na ČERSTVÉ databázi tudy baseline projde
-- DŘÍV, než tabulka vznikne, a holý REVOKE shodí celý apply:
--     ERROR: relation "public.migration_log_dump" does not exist
-- Produkce si toho nevšimne (tam tabulka dávno je), pozná to jen cold-start.
-- Táž třída jako `to_regprocedure` u REVOKE na funkci: na co není v SoT, se musí
-- sahat PODMÍNĚNĚ.
DO $$
BEGIN
  IF to_regclass('public.migration_log_dump') IS NULL THEN
    RAISE NOTICE 'migration_log_dump zatim neexistuje (zaklada ji migracni beh) - preskakuji';
    RETURN;
  END IF;
  REVOKE INSERT, UPDATE, DELETE ON TABLE public.migration_log_dump FROM authenticated;
  -- Čtení zůstává oběma rolím (anon kvůli cold-startu, authenticated je podmnožina).
  GRANT SELECT ON TABLE public.migration_log_dump TO anon, authenticated;
END $$;

-- ⛔ E-MAILY Z UŽ ULOŽENÝCH ŘÁDKŮ (audit veřejného vydání 2026-10-01): dřívější běhy uložily
-- adresy operátorů do `output` (provisioning `✓ <e-mail> → …`, `PROVISION_GRANTED email=…`) a
-- tabulku čte `anon`. Nové běhy maskuje write_dump v docker-migrate-entrypoint.sh; tady se
-- vyčistí historie. Idempotentní (WHERE), na čerstvé DB tabulka neexistuje → přeskočí.
DO $$
BEGIN
  IF to_regclass('public.migration_log_dump') IS NOT NULL THEN
    UPDATE public.migration_log_dump
       SET output = regexp_replace(output, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<e-mail>', 'g')
     WHERE output ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';
  END IF;
  IF to_regclass('aisha_meta.migration_log') IS NOT NULL THEN
    UPDATE aisha_meta.migration_log
       SET error_message = regexp_replace(error_message, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<e-mail>', 'g')
     WHERE error_message ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';
  END IF;
END $$;
