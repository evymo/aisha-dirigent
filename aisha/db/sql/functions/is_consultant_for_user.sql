-- Function: public.is_consultant_for_user
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:54+01:00

CREATE OR REPLACE FUNCTION public.is_consultant_for_user(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Vazba „volající smí do dat uživatele p_user_id jako jeho konzultant".
  -- Platí jen tehdy, když JSOU SPLNĚNY VŠECHNY čtyři podmínky:
  --   1. volající je PŘIHLÁŠENÝ a EXISTUJÍCÍ účet — gateway razí roli
  --      `authenticated` i návštěvníkovi bez účtu, takže role nestačí;
  --   2. je schváleným konzultantem studie,
  --   3. v níž je p_user_id aktivně zapsaný,
  --   4. a p_user_id dal TOMUTO konzultantovi platný souhlas se sdílením dat.
  -- Vlastní data čte člen přes svou policy (user_id = auth.uid()), ne přes tuhle
  -- vazbu. Souhlas se ověřuje UVNITŘ (rozhodnutí 2026-10-05): funkce pak sama nic
  -- neprozradí — bez souhlasu je odpověď „ne", i když zápis ve studii existuje.
  -- Bez auditního zápisu: běží v RLS predikátu per řádek (audit čtení zapisuje
  -- souhlasová funkce, kterou policy volá vedle).
  SELECT auth.uid() IS NOT NULL
     AND p_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = auth.uid())
     AND EXISTS (
       SELECT 1
       FROM study_registrations se
       JOIN study_consultants sc ON sc.study_id = se.study_id
       JOIN partner_profiles pp ON pp.id = sc.partner_id
       WHERE se.user_id = p_user_id
         AND pp.user_id = auth.uid()
         AND sc.status = 'approved'
         AND se.status IN ('active', 'enrolled')
         AND EXISTS (
           SELECT 1
           FROM data_sharing_consents dsc
           WHERE dsc.user_id = p_user_id
             AND dsc.partner_id = pp.id
             AND dsc.revoked_at IS NULL
             AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
         )
     );
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_consultant_for_user(p_user_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_consultant_for_user(p_user_id uuid) FROM anon;
-- ⛔ NAMĚŘENO 2026-08-12: funkce neměla ANI JEDEN grant, ačkoli ji volá devět politik
-- na tabulkách se zdravotními daty. PostgreSQL vyhodnocuje VŠECHNY použitelné
-- politiky, takže člen, který si četl SVÁ data, spadl na „permission denied for
-- function is_consultant_for_user" — nečetl ani svoje. Grant čekal na rozhodnutí,
-- kde má žít kontrola souhlasu; rozhodnuto 2026-10-05: přímo ve funkci (výš).
-- anon grant nemá: nepřihlášený nemá konzultantský vztah k nikomu a „permission
-- denied" na zdravotní tabulce je pro něj fail-closed.
GRANT EXECUTE ON FUNCTION public.is_consultant_for_user(p_user_id uuid) TO authenticated, service_role;
