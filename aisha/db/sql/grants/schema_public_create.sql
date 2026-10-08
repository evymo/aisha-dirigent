-- Schéma public: vytvářet v něm smí jen vlastník a role, která to má výslovně.
--
-- ⛔ ZMĚŘENO 2026-10-03 na živé instanci: ACL schématu public bylo
-- {vlastník=UC, postgres=UC, =UC} — právo CREATE pro PUBLIC, tedy pro každou
-- roli, která se umí přihlásit. Původ: reset schématu v migraci dával USAGE
-- i CREATE všem a proběhne při každém studeném startu (viz
-- scripts/db/lib/reset-public-schema.mjs). Baseline se na běžící databázi
-- nepřehrává, takže odebrání musí přijít tudy.
--
-- PROČ TO VADÍ: funkce SECURITY DEFINER v public patří superuživateli a volají
-- další funkce a operátory bez kvalifikace. Kdo smí v public vytvářet, podstrčí
-- přetížení s přesnějším typem argumentu a jeho kód poběží právy vlastníka.
--
-- POŘADÍ JE SOUČÁST OPRAVY. Tentýž reset smazal výslovný grant roli NocoDB, která
-- v public drží své tabulky a při startu zakládá další; dokud měla CREATE přes
-- PUBLIC, nebylo to vidět. Grant se jí proto vrací DŘÍV, než se PUBLIC odebere,
-- a obojí v JEDNOM bloku — nesmí existovat stav, kdy vytvářet nemůže.
--
-- ODEBÍRÁ SE PO UDĚLOVATELÍCH. `REVOKE` odvolá jen to, co udělil ten, kdo ho
-- pouští (superuživatel jedná jménem vlastníka schématu); právo udělené jinou
-- rolí přeskočí nanejvýš s varováním. Blok proto projde záznamy ACL a zbylé
-- právo odvolá jménem každého udělovatele zvlášť.
--
-- VÝSLEDEK SE ZMĚŘÍ, ALE MIGRACI NEZASTAVÍ. Zastavená migrace je nenasazené
-- jádro — ze zpevnění by byl výpadek kvůli stavu, který běžící nasazení samo
-- nespraví. Co odebrat nejde, ohlásí varování s udělovatelem; natvrdo to hlídá
-- ověření po nasazení (scripts/verify-live-instance.sh) a brána cesty upgradu.
--
-- Idempotentní. Na čisté databázi (PostgreSQL 15+ dává PUBLIC jen USAGE) je
-- REVOKE bez účinku a smyčka neproběhne ani jednou.
DO $$
DECLARE
  u record;
  zbyva text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nocodb_app') THEN
    GRANT USAGE, CREATE ON SCHEMA public TO nocodb_app;
  END IF;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  FOR u IN
    SELECT DISTINCT a.grantor::regrole::text AS udelil
      FROM pg_namespace n, aclexplode(n.nspacl) a
     WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %s', u.udelil);
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      SET LOCAL ROLE NONE;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'schéma public: právo CREATE pro PUBLIC nejde odvolat jménem role % (%)', u.udelil, SQLERRM;
    END;
  END LOOP;

  SELECT string_agg(DISTINCT a.grantor::regrole::text, ', ')
    INTO zbyva
    FROM pg_namespace n, aclexplode(n.nspacl) a
   WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE';
  IF zbyva IS NOT NULL THEN
    RAISE WARNING 'schéma public: PUBLIC má právo CREATE i po odebrání (udělil: %) — každá role, která se přihlásí, může v public vytvářet; odvolej ho jménem udělovatele', zbyva;
  END IF;
END
$$;
