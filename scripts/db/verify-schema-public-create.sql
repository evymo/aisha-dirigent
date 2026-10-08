-- =============================================================================
-- verify-schema-public-create.sql — kdo smí vytvářet ve schématu public
-- =============================================================================
-- Měří se DVAKRÁT, protože každé měření samo může lhát:
--   CHOVÁNÍ — pod KAŽDOU ne-superuživatelskou rolí z pg_roles (ne podle seznamu)
--             se zkusí založit tabulka. Uspět smí jen role vyjmenované níž.
--   ACL     — právo CREATE smí v záznamech schématu mít jen vlastník, `postgres`
--             a vyjmenované role; PUBLIC nikdy.
--
-- Každý pokus běží v podtransakci, která se VŽDY vrátí zpět — po běhu v databázi
-- nic nezůstane. I vrácený pokus je ale zápisový pokus a ve stavu „díra“ uspěje:
-- tahle kontrola patří JEN nad zahazovanou nebo zkušební databázi (pouští ji brána
-- cesty upgradu). Nad živou instancí se pouští čtecí sestra
-- scripts/db/verify-schema-public-acl.sql; brána upgradu pouští obě a musí se shodnout.
--
-- Skončí chybou a vyjmenuje VŠECHNY odchylky najednou. Kontrolní vzorek je
-- povinný: bez jediné odmítnuté role a bez role, která vytvářet smí a opravdu
-- vytvořila, by „nikdo nesmí“ platilo i nad databází, kde nefunguje nic.
--
--   psql "$URL" -v ON_ERROR_STOP=1 -f scripts/db/verify-schema-public-create.sql
-- =============================================================================
DO $$
DECLARE
  smi_vytvaret CONSTANT text[] := ARRAY['nocodb_app'];
  musi_pouzivat CONSTANT text[] := ARRAY['anon', 'authenticated', 'service_role'];
  vlastnik text;
  r record;
  jmeno text;
  vysledek text;
  vady text[] := '{}';
  vytvorili text[] := '{}';
  v_acl text[] := '{}';
  odmitnuto int := 0;
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

  -- ── CHOVÁNÍ ──────────────────────────────────────────────────────────────
  FOR r IN
    SELECT rolname::text AS rolname
      FROM pg_roles
     WHERE NOT rolsuper
       AND rolname !~ '^pg_'
       AND rolname <> vlastnik
     ORDER BY rolname
  LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r.rolname);
      CREATE TABLE public._zkouska_kdo_smi_vytvaret ();
      -- Vlastní kód chyby: vytvoření PROŠLO; podtransakce se vrátí (tabulka i role).
      RAISE EXCEPTION USING ERRCODE = 'ZK001', MESSAGE = 'vytvořeno';
    EXCEPTION
      WHEN insufficient_privilege THEN vysledek := 'odmítnuto';
      WHEN SQLSTATE 'ZK001' THEN vysledek := 'vytvořeno';
    END;

    IF vysledek = 'vytvořeno' THEN
      vytvorili := vytvorili || r.rolname;
      IF r.rolname <> ALL (smi_vytvaret) THEN
        vady := vady || format('role %s ve schématu public vytvořila tabulku', r.rolname);
      END IF;
    ELSIF r.rolname = ANY (smi_vytvaret) THEN
      vady := vady || format('role %s vytvářet má, ale nesmí', r.rolname);
    ELSE
      odmitnuto := odmitnuto + 1;
    END IF;
  END LOOP;

  -- ── kontrolní vzorky ─────────────────────────────────────────────────────
  FOREACH jmeno IN ARRAY smi_vytvaret LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = jmeno) THEN
      vady := vady || format('kontrolní vzorek chybí: role %s neexistuje', jmeno);
    END IF;
  END LOOP;
  IF odmitnuto = 0 THEN
    vady := vady || 'kontrolní vzorek chybí: žádná role nebyla odmítnuta'::text;
  END IF;

  FOREACH jmeno IN ARRAY musi_pouzivat LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = jmeno)
       OR NOT has_schema_privilege(jmeno, 'public', 'USAGE') THEN
      vady := vady || format('role %s nemá ve schématu public USAGE', jmeno);
    END IF;
  END LOOP;

  RAISE NOTICE 'schéma public (vlastník %) — CREATE v ACL: [%]; pokus o CREATE TABLE prošel: [%]; odmítnuto rolí: %',
    vlastnik, array_to_string(v_acl, ', '), array_to_string(vytvorili, ', '), odmitnuto;

  IF cardinality(vady) > 0 THEN
    RAISE EXCEPTION 'schéma public — kdo smí vytvářet: %', array_to_string(vady, '; ');
  END IF;
END
$$;
