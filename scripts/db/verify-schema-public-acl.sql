-- =============================================================================
-- verify-schema-public-acl.sql — kdo smí vytvářet ve schématu public (JEN ČTENÍM)
-- =============================================================================
-- Kontrola pro ŽIVOU databázi: nic nezakládá, nic nezkouší zapsat. Čte katalog:
--   ACL       — právo CREATE smí v záznamech schématu mít jen vlastník, `postgres`
--               a vyjmenované role; PUBLIC nikdy.
--   OPRÁVNĚNÍ — has_schema_privilege(role, 'public', 'CREATE') pro KAŽDOU
--               ne-superuživatelskou roli z pg_roles (ne podle seznamu); počítá
--               i právo zděděné přes PUBLIC nebo členství.
--   VLASTNÍCI — výčet, kdo ve schématu vlastní relace a funkce. Role, která tu
--               něco vlastní a vytvářet nesmí, nezaloží tabulku ani index — proto
--               se vypisuje, i když sama o sobě není vadou.
--
-- Sestra scripts/db/verify-schema-public-create.sql, která totéž měří CHOVÁNÍM
-- (pokus o CREATE TABLE pod každou rolí). Ta patří jen nad zahazovanou databázi;
-- brána cesty upgradu pouští OBĚ a musí se shodnout — čtecí kontrola nesmí být
-- zelená tam, kde chování ukáže díru.
--
-- Pouští se v transakci jen pro čtení (default_transaction_read_only=on), takže
-- zápis by tu skončil chybou, ne zápisem. Skončí chybou a vyjmenuje VŠECHNY
-- odchylky najednou; kontrolní vzorky jsou povinné jako u sestry.
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$URL" -v ON_ERROR_STOP=1 -f scripts/db/verify-schema-public-acl.sql
-- =============================================================================
DO $$
DECLARE
  smi_vytvaret CONSTANT text[] := ARRAY['nocodb_app'];
  musi_pouzivat CONSTANT text[] := ARRAY['anon', 'authenticated', 'service_role'];
  vlastnik text;
  r record;
  jmeno text;
  vady text[] := '{}';
  v_acl text[] := '{}';
  smeji text[] := '{}';
  vlastnici text[] := '{}';
  nesmi int := 0;
BEGIN
  SELECT pg_get_userbyid(n.nspowner) INTO vlastnik FROM pg_namespace n WHERE n.nspname = 'public';

  -- ── ACL ──────────────────────────────────────────────────────────────────
  FOR r IN
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS komu
      FROM pg_namespace n, aclexplode(n.nspacl) a
     WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
     ORDER BY 1
  LOOP
    v_acl := v_acl || r.komu;
    IF r.komu = 'PUBLIC' THEN
      vady := vady || 'PUBLIC má ve schématu public právo CREATE'::text;
    ELSIF r.komu <> vlastnik AND r.komu <> 'postgres' AND r.komu <> ALL (smi_vytvaret) THEN
      vady := vady || format('ACL schématu public dává právo CREATE roli %s', r.komu);
    END IF;
  END LOOP;

  -- ── OPRÁVNĚNÍ ────────────────────────────────────────────────────────────
  FOR r IN
    SELECT rolname::text AS rolname
      FROM pg_roles
     WHERE NOT rolsuper
       AND rolname !~ '^pg_'
       AND rolname <> vlastnik
     ORDER BY rolname
  LOOP
    IF has_schema_privilege(r.rolname, 'public', 'CREATE') THEN
      smeji := smeji || r.rolname;
      IF r.rolname <> ALL (smi_vytvaret) THEN
        vady := vady || format('role %s smí ve schématu public vytvářet', r.rolname);
      END IF;
    ELSIF r.rolname = ANY (smi_vytvaret) THEN
      vady := vady || format('role %s vytvářet má, ale nesmí', r.rolname);
    ELSE
      nesmi := nesmi + 1;
    END IF;
  END LOOP;

  -- ── kontrolní vzorky ─────────────────────────────────────────────────────
  FOREACH jmeno IN ARRAY smi_vytvaret LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = jmeno) THEN
      vady := vady || format('kontrolní vzorek chybí: role %s neexistuje', jmeno);
    END IF;
  END LOOP;
  IF nesmi = 0 THEN
    vady := vady || 'kontrolní vzorek chybí: žádná role není bez práva vytvářet'::text;
  END IF;

  FOREACH jmeno IN ARRAY musi_pouzivat LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = jmeno)
       OR NOT has_schema_privilege(jmeno, 'public', 'USAGE') THEN
      vady := vady || format('role %s nemá ve schématu public USAGE', jmeno);
    END IF;
  END LOOP;

  -- ── VLASTNÍCI ────────────────────────────────────────────────────────────
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO vlastnici
    FROM (
      SELECT format('%s: %s relací', pg_get_userbyid(c.relowner), count(*)) AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
       GROUP BY c.relowner
      UNION ALL
      SELECT format('%s: %s funkcí', pg_get_userbyid(p.proowner), count(*))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
       GROUP BY p.proowner
    ) t;

  RAISE NOTICE 'schéma public (vlastník %) — CREATE v ACL: [%]; právo vytvářet mají role: [%]; bez práva: % rolí',
    vlastnik, array_to_string(v_acl, ', '), array_to_string(smeji, ', '), nesmi;
  RAISE NOTICE 'schéma public — vlastníci objektů: %', array_to_string(vlastnici, '; ');

  IF cardinality(vady) > 0 THEN
    RAISE EXCEPTION 'schéma public — kdo smí vytvářet: %', array_to_string(vady, '; ');
  END IF;
END
$$;
