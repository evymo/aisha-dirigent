-- =============================================================================
-- 24_publish_plugins_permission.sql — úzké právo publikovat plugin
-- =============================================================================
-- ⛔ PROČ VZNIKLO (naměřeno 2026-09-02). `submit_plugin` autorizuje přes
-- `is_admin_or_staff()`, takže STROJ, který má do katalogu dostat naše vlastní
-- pluginy, by musel dostat roli `admin` nebo `staff`. Tím by ale dostal VŠECHNO,
-- co staff smí — a hůř: až někdo staffovi přidá další právo, servisní účet ho
-- TIŠE dostane taky, aniž by takové rozhodnutí kdokoli udělal.
--
-- ⭐ ROLE ODPOVÍDÁ NA „KDO TO JE“, OPRÁVNĚNÍ NA „CO SMÍ“. Servisní účet není
-- staff: nemá kolegy, nechodí do administrace, nemá kontext. Má JEDEN úkol.
-- Popsat ho rolí by znamenalo prohlásit ho za někoho, kým není, jen aby prošel
-- jednou stráží.
--
-- Následek prázdného katalogu je přitom měřitelný: zdroje `money`
-- a `webdispecink-fleet` byly 2026-09-02 zapnuté přes dvě hodiny a nepřibyl ani
-- jeden řádek — `plugin_catalog` i `plugin_schedules` měly nula záznamů, takže
-- nebylo co naplánovat ani co spustit.
-- =============================================================================

INSERT INTO public.permissions (code, name, description, category, is_system)
VALUES
  ('publish_plugins', 'Publish Plugins',
   'Smí zapsat plugin do katalogu (submit_plugin). Úzká náhrada role admin/staff '
   || 'pro servisní účty publikační dráhy; tier je pevně internal, volit ho nelze.',
   'plugins', true)
ON CONFLICT (code) DO NOTHING;

-- ⛔ ŽÁDNÝ VÝCHOZÍ GRANT NA ROLI. `access_studio` ho má, protože admin ta
-- nástroje beztak spravuje. Tady by výchozí grant znamenal, že se právo rozdá
-- plošně dřív, než ho někdo komu udělí — a smysl úzkého oprávnění je opačný:
-- uděluje se JMENOVITĚ, jednomu účtu, se zápisem kdo a kdy (`user_roles`
-- respektive `role_permissions` nesou `granted_by`/`granted_at`).
