-- ============================================================================
-- Bezpečnostní oprava 2026-07-31: odebrat `authenticated` právo na SECURITY
-- DEFINER funkce, které nemají vlastní kontrolu nároku.
--
-- ZMĚŘENO NA PRODUKCI pod identitou BEZ JAKÝCHKOLI ROLÍ (extranet-test-clen,
-- token ražený jako gateway, volání přes veřejné api.<tld>):
--
--   assemble_surface_traced('workbench')  → HTTP 200, 631 035 B:
--       wb_register    500 řádků dokladů   (111 kB)
--       wb_obligations 509 závazků         (543 kB)
--       wb_findings    164 nálezů           (67 kB)
--     …a to PŘESTO, že tytéž bloky přes get_block_data vracely témuž uživateli
--     prázdno. Kořen: funkce je DEFINER a uvnitř volá get_block_data, který je
--     INVOKER — jenže „volajícím" INVOKER funkce je pak VLASTNÍK deferera
--     (superuser s RLS bypass), ne původní uživatel. Jedno volání o úroveň výš
--     tak obešlo celou RLS doktrínu repa.
--     V repu ji NIKDO nevolá (grep přes ts/tsx/mjs/json) — je to vývojová
--     diagnostika. Zůstává service_role, kde je bypass legitimní a záměrný.
--
--   db_diagnose()                → HTTP 200: „61 tables without RLS enabled"
--     Průzkum vnitřní struktury pro kohokoli přihlášeného.
--   cleanup_inactive_sessions()  → HTTP 204 (prošlo!)
--   cleanup_old_rate_limits()    → HTTP 200
--   cleanup_stale_mobile_sessions(), backfill_user_streaks() → táž třída
--     Mutační údržba spustitelná kýmkoli přihlášeným = DoS/mutace páka.
--     Patří plánovači (service_role), ne uživateli.
--
-- Kontrolní vzorek TÉHOŽ běhu (ať je vidět, že měřidlo měřilo identitu, ne
-- výpadek): admin přes tytéž cesty data dostal, anon dostal 401.
--
-- POZOR na příště: `assemble_surface_traced` je JEDINÁ funkce své třídy
-- (dotaz: definer && prosrc ~ 'get_block_data|get_surface_layout'). Novou
-- takovou hlídá brána definer-nesmi-obchazet-invoker.
-- ============================================================================

-- ⚠️ REVOKE MUSÍ BÝT TOLERANTNÍ K NEEXISTENCI. Cold-start to odhalil hned:
-- `assemble_surface_traced` NEMÁ SoT soubor — žije jen v produkční databázi
-- (drift, zásah mimo git). Na čerstvé DB tedy neexistuje a prostý REVOKE
-- shodí celý apply (`ERROR: function … does not exist`). Totéž platí pro
-- upstreamové údržbové funkce, které si instance nemusí nést. Kontrola přes
-- pg_proc + dynamický REVOKE dělá soubor idempotentním na obou drahách:
-- na běžící DB odebere, na čisté mlčky přeskočí.
DO $$
DECLARE
  -- Plně kvalifikované signatury tak, jak je čte to_regprocedure().
  targets text[] := ARRAY[
    'public.assemble_surface_traced(text)',      -- únik: definer → invoker → RLS bypass
    'public.db_diagnose()',                      -- průzkum struktury („61 tables without RLS")
    'public.cleanup_inactive_sessions()',        -- mutační údržba, patří plánovači
    'public.cleanup_old_rate_limits()',
    'public.cleanup_stale_mobile_sessions()',
    'public.backfill_user_streaks()'
  ];
  t   text;
  sig regprocedure;
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- to_regprocedure() vrací NULL (nikoli chybu), když funkce neexistuje —
    -- na rozdíl od přetypování '…'::regprocedure. To je celý ten rozdíl mezi
    -- souborem, který na čisté DB projde, a tím, co shodí cold-start.
    sig := to_regprocedure(t);
    IF sig IS NULL THEN
      RAISE NOTICE 'preskakuji % (v této databázi neexistuje)', t;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', sig);
    RAISE NOTICE 'odebrano authenticated EXECUTE na %', sig;
  END LOOP;
END $$;
