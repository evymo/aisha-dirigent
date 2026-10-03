-- insert_audit_journal_entry: Wrapper for edge functions to log audit events
-- Called by: toolExecutor.ts (service), n8n (service), mobile-app biometric (sám za sebe)
-- Security: za cizí user_id smí psát jen service_role (2026-09-19).
CREATE OR REPLACE FUNCTION public.insert_audit_journal_entry(
  p_action text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- ⛔ PODVRH AUDITU POD CIZÍM JMÉNEM (naměřeno 2026-09-19). GRANT pro
  -- `authenticated` + volný p_user_id znamenal, že kterýkoli přihlášený zapsal
  -- do audit_journal záznam s `user_id` KOHOKOLI — tedy „tohle udělal admin X".
  -- Audit, do kterého smí psát cizí jménem kdokoli, nic nedokazuje.
  --
  -- Za jiného smí psát jen služba (toolExecutor, n8n — nesou service klíč
  -- a user_id z ověřeného kontextu). Správa NE: audit je právě místo, kde se
  -- nesmí vydávat za jiného ani správce. Změřeno, že to nic nerozbije: mobilní
  -- appka (biometric) p_user_id neposílá (výchozí = volající), toolExecutor
  -- a n8n volají service klíčem. `IS DISTINCT FROM` + `auth.uid() IS NULL`
  -- drží stráž NULL-bezpečnou.
  IF NOT public.is_service_role()
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
  THEN
    RAISE EXCEPTION 'Unauthorized: audit entry may only be written for the caller'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (p_user_id, p_action, p_metadata);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_audit_journal_entry(text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_audit_journal_entry(text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_audit_journal_entry(text, jsonb, uuid) TO authenticated;
