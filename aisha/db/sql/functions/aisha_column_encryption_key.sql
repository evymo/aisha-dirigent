-- ============================================================================
-- Source of truth: aisha_column_encryption_key
--
-- OWASP A02 — Cryptographic Failures. Klíč pgp_sym pro šifrování sloupců
-- (aisha_{encrypt,decrypt}_column_audited). Hodnotu doručuje trezor instance
-- (COLUMN_ENCRYPTION_KEY v env služby db) — NIKDY v repu.
--
-- ⛔ KLÍČ NENÍ GUC. Dřív ho nesl `ALTER DATABASE postgres SET
-- app.column_encryption_key` (+ PGOPTIONS). NAMĚŘENO 2026-09-25 na dočasné DB:
-- vlastní GUC nejde omezit, takže ho přes current_setting() / pg_db_role_setting
-- přečetla KAŽDÁ role — 11 login rolí i anon/authenticated/service_role — a
-- anon s ním dešifroval sloupec mimo audit. REVOKE na téhle funkci byl divadlo.
--
-- ✅ Teď: entrypoint-wrapper.sh při startu zapíše klíč do souboru mimo databázi
-- (/run/aisha-keys, vlastník postgres, 0400) a tahle funkce ho čte. Klíč tak
-- není v GUC, v katalogu ani v záloze DB. Čte ji jen VLASTNÍK (superuživatel,
-- který ji zakládá migrate) — tedy definer funkce téhož vlastníka. Žádný GRANT:
-- dřívější grant pro service_role dával klíč i přes PostgREST /rpc.
--
-- Chybějící nebo slabý klíč = výjimka. Žádná záloha na GUC ani jiný zdroj.
-- Brány: src/tests/gates/klice-sifrovani-doruceni.gate.test.ts (kontrakt
-- doručení), src/tests/db/tajemstvi-nejsou-citelna.runtime.test.ts (čitelnost).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_column_encryption_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_key text;
BEGIN
  BEGIN
    -- Bez ořezu: hodnota musí být BAJTOVĚ táž jako dřív v GUC (jinak starý
    -- šifrový text nejde otevřít); zapisovatel píše printf '%s', bez konce řádku.
    v_key := pg_read_file('/run/aisha-keys/column_encryption.key');
  EXCEPTION
    WHEN undefined_file THEN
      RAISE EXCEPTION 'AISHA_ENCRYPTION_KEY_MISSING_OR_WEAK'
        USING DETAIL = 'Soubor /run/aisha-keys/column_encryption.key neexistuje.',
              HINT = 'Zapisuje ho infra/postgres/entrypoint-wrapper.sh z COLUMN_ENCRYPTION_KEY při startu služby db.';
  END;
  IF v_key IS NULL OR length(v_key) < 32 THEN
    RAISE EXCEPTION 'AISHA_ENCRYPTION_KEY_MISSING_OR_WEAK';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.aisha_column_encryption_key() FROM PUBLIC;
-- Existující DB drží dřívější grant pro service_role — výslovně odebrat.
REVOKE ALL ON FUNCTION public.aisha_column_encryption_key() FROM anon, authenticated, service_role;
