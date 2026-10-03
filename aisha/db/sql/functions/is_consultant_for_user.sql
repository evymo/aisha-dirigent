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
  SELECT EXISTS (
    SELECT 1
    FROM study_registrations se
    JOIN study_consultants sc ON sc.study_id = se.study_id
    JOIN partner_profiles pp ON pp.id = sc.partner_id
    WHERE se.user_id = p_user_id
      AND pp.user_id = auth.uid()
      AND sc.status = 'approved'
      AND se.status IN ('active', 'enrolled')
  );
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_consultant_for_user(p_user_id uuid) FROM PUBLIC;
-- ⛔ NAMĚŘENO 2026-08-12: tahle funkce neměla ANI JEDEN grant. Nesměl ji spustit
-- nikdo — ani `authenticated`. Přitom ji volá DEVĚT politik na tabulkách se
-- zdravotními daty (health_data, lab_results, dosing_logs, wearables_data,
-- health_check_ins, operational_assessments, consents, member_distribution_plans,
-- member_compliance_scores).
--
-- PostgreSQL při SELECTu vyhodnocuje VŠECHNY použitelné politiky, ne jen tu,
-- která by řádek povolila. Takže člen, který si chce přečíst SVÁ VLASTNÍ data,
-- narazil na konzultantskou politiku a celý dotaz spadl na
-- „permission denied for function public.is_consultant_for_user".
-- Nešlo o „nevidí cizí" — nevidí ani svoje.
--
-- je „permission denied" na PHI tabulce fail-CLOSED, tedy správné chování.
-- Živá vada byla jinde: chyběl grant pro `authenticated`, což je role, kterou
-- gateway razí i nepřihlášenému návštěvníkovi.
-- ⚠️ ZÁMĚRNĚ BEZ GRANTU — a je to ZNÁMÁ ŽIVÁ VADA, ne stav, který by byl v pořádku.
--
-- Funkci volá DEVĚT politik na tabulkách se zdravotními daty. Bez grantu pro
-- `authenticated` spadne KAŽDÝ dotaz na ty tabulky na „permission denied for
-- function" — člen si nepřečte ani svoje vlastní health_data či lab_results.
--
-- Grant sem ale nemůže padnout jen tak: security.gate vyžaduje, aby funkce
-- sahající na PHI a mající klientský grant obsahovala kontrolu souhlasu UVNITŘ
-- SEBE. Tahle ji uvnitř nemá — mají ji všechny politiky, které ji volají
-- (has_data_sharing_consent, ověřeno u všech devíti).
--
-- Otevřené rozhodnutí (viz PR):
--   A) přidat kontrolu souhlasu i dovnitř funkce — dvojitá ochrana, ale dva
--      zdroje pravdy, které se časem rozejdou
--   B) naučit analyzátor uznat souhlas v politice — přesnější, ale je to změna
--      bezpečnostního pravidla kolem PHI a nepodařilo se mi ji OVĚŘIT mutací
--
-- Do rozhodnutí zůstává bez grantu. Brána politika-vola-jen-spustitelne tuhle
-- funkci proto zná jako doloženou výjimku — ne jako přehlédnutí.
-- Role bez oprávnění ZÁMĚRNĚ: konzultantský přístup k PHI je vázaný na souhlas,
-- takže ho nepřihlášený spouštět nemá — hlídá security.gate. Pro něj je
-- „permission denied" na PHI tabulce fail-CLOSED, tedy správné chování.
-- Živá vada byla jinde: chyběl grant pro `authenticated`, což je role, kterou
-- gateway razí i nepřihlášenému návštěvníkovi.
