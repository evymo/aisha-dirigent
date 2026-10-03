-- Function: public.can_access_admin_section
-- Arguments: p_section text, p_user_id uuid (optional, defaults to auth.uid())
-- Description: Check if user has access to admin section.
-- Security: SECURITY DEFINER, authenticated users only; auth-first — přihlášený se ptá vždy
--   za sebe, p_user_id platí jen pro service_role (JWT bez identity). 2026-09-19.
-- Updated: 2026-01-09 - Added p_user_id param for flexibility

CREATE OR REPLACE FUNCTION public.can_access_admin_section(
  p_section text,
  p_user_id uuid DEFAULT NULL
)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). S pořadím
  -- COALESCE s parametrem na prvním místě vyhrál parametr, takže „může uuid X do
  -- admin sekce Y?" odpovídalo na role CIZÍHO účtu sekci po sekci. Parametr
  -- přibyl 2026-01-09 „pro flexibilitu" a nikdo ho nepotřebuje: v repu funkci
  -- nevolá žádná politika, funkce ani klient.
  --
  -- Oprava je fáze 2 z brány security-hardened-helpers: JWT vyhrává
  -- (`COALESCE(auth.uid(), p_user_id)`). Přihlášený se tak ptá vždy za sebe;
  -- parametr platí jen tam, kde JWT identitu nenese (service_role). Anon na
  -- funkci právo nemá — kdyby ho dostal, auth-first by ho NEchránil (uid NULL
  -- → vyhraje parametr); hlídá to brána definer-subjekt-jen-volajici.
  SELECT public.has_section_access(COALESCE(auth.uid(), p_user_id), p_section, 'read');
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.can_access_admin_section(p_section text, p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_admin_section(p_section text, p_user_id uuid) TO authenticated;
