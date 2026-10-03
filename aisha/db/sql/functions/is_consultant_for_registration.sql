-- Function: public.is_consultant_for_registration
-- Arguments: p_registration_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:53+01:00

CREATE OR REPLACE FUNCTION public.is_consultant_for_registration(p_registration_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM study_registrations se
    JOIN study_consultants sc ON sc.study_id = se.study_id
    JOIN partner_profiles pp ON pp.id = sc.partner_id
    WHERE se.id = p_registration_id
      AND pp.user_id = auth.uid()
      AND sc.status = 'approved'
  );
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_consultant_for_registration(p_registration_id uuid) FROM PUBLIC;
-- ⛔ Původně „No GRANT - internal/helper function". Jenže ji VOLÁ RLS politika,
-- a PostgreSQL vyhodnocuje politiky pod rolí volajícího — ne pod definerem.
-- Bez grantu spadne každý dotaz na dotčenou tabulku na
-- „permission denied for function". Buď grant, nebo ji politika volat nesmí.
-- SECURITY DEFINER, boolean, uvnitř pp.user_id = auth.uid() → pro anon false.
-- ANON ZÁMĚRNĚ NE: repo má konzistentní postoj (tři nezávislé brány), že
-- pomocníky pro kontrolu oprávnění anonym spouštět nemá. Živá vada byla
-- u `authenticated` — role, kterou gateway razí i nepřihlášenému.
GRANT EXECUTE ON FUNCTION public.is_consultant_for_registration(p_registration_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_consultant_for_registration(p_registration_id uuid) TO service_role;
