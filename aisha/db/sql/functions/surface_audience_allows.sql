-- ============================================================================
-- Source of Truth: surface_audience_allows
-- Popis: Sdílený predikát „smí tenhle uživatel vidět tohle umístění?" nad
--        deklarací surface_layouts.audience. JEDINÉ místo, které deklaraci
--        publika interpretuje — RLS ji jen zavolá, čtenáři layoutu (get_surface_layout,
--        list_surface_sections) se nemění ani o řádek.
--
-- PROČ VZNIKLO: sloupec `audience jsonb` existoval od začátku s komentářem
-- „Vyhodnocení se doplní do RLS/RPC — sloupec drží deklaraci", ale nikdo ho
-- nečetl. Důsledek naměřený naživo: KAŽDÝ přihlášený dostal z
-- list_surface_sections() všech šest sekcí včetně 'admin', protože jediná
-- policy pro authenticated měla v USING pouze `is_active = true`. Data bloku
-- RLS ořeže, ale JMÉNA SEKCÍ prosákla — a povrch, který má člověku ukázat
-- výhradně jeho práci, nesmí prozradit, co všechno existuje.
--
-- MODEL (majitel 07-25): oprávnění neplyne z role jako jmenovky, plyne z toho,
-- s čím je člověk spojen. Deklarace je proto ZÁMĚRNĚ malá a skládá jen
-- vlastnosti, které umí doložit existující mašinerie:
--
--   {}                              ungated — vidí každý přihlášený
--   {"roles": ["admin","staff"]}    aspoň jedna z rolí (has_role)
--   {"min_tier": "qualified"}       úroveň účasti (audience_user_meets_tier_requirement)
--   {"udeleni": "smlouvy"}          uživatel má na sekci UDĚLENÍ (surface_section_grants)
--
-- ⭐ OSA UDĚLENÍ (rozhodnutí majitele 2026-09-28): přístup do sekce se nastavuje
-- u uživatele v administraci, ne rolí — „přístup k datům z úhlu pohledu je jedna
-- věc, přístup do sekce extranetu je další úroveň". Udělení otevírá umístění;
-- co v sekci uvidí, dál řídí nárok na data (RLS). Hodnota = klíč sekce
-- (^[a-z][a-z0-9_]*$), jiný tvar = DENY.
--
-- Obojí zároveň = AND (obě podmínky musí platit). Prázdná deklarace propouští
-- schválně: je to parita s 2-arg tier funkcí, která na NULL požadavek vrací
-- true, a znamená to, že zavedení téhle brány nemůže samo o sobě nikomu nic
-- vzít — dokud instance nedeklaruje, nic se nemění.
--
-- FAIL CLOSED NA NEZNÁMÝ KLÍČ: deklarace s klíčem, kterému tahle funkce
-- nerozumí, DENY. Překlep (`role` místo `roles`) jinak tiše otevře sekci všem
-- a nikdo si toho nevšimne — tichá díra je horší než hlasité prázdno.
--
-- ADMIN/STAFF BYPASS: kdo provoz řídí, vidí všechna umístění. Bez toho by
-- deklarace na sekci uzamkla i toho, kdo ji spravuje, a jediná policy pro
-- authenticated nemá kudy uhnout.
--
-- PROČ DEFINER: 2-arg audience_user_meets_tier_requirement(text, uuid) je
-- grantovaná POUZE service_role. Výraz v RLS se vyhodnocuje právy dotazujícího,
-- takže přímé použití v policy pro authenticated skončí „permission denied for
-- function", ne prázdnem. DEFINER wrapper grantovaný authenticated je kanonická
-- cesta — přesně tak to dělá document_visible_to.
--
-- PROČ plpgsql: tělo se při CREATE neparsuje, takže funkce nezávisí na pořadí
-- vzniku ostatních funkcí a baseline projde na ČISTÉ DB (tatáž úvaha jako u
-- workflow_step_visible_to).
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.surface_audience_allows(
  p_uid      uuid,
  p_audience jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key       text;
  v_role      text;
  v_role_hit  boolean := false;
  v_min_tier  text;
  v_sekce     text;
BEGIN
  -- Oracle guard: přihlášený smí vyhodnocovat JEN SVOJI viditelnost, jinak by
  -- predikát šel použít jako čtečka cizích oprávnění (tatáž úvaha jako
  -- document_visible_to). IS NOT DISTINCT FROM = NULL-safe.
  IF NOT (p_uid IS NOT DISTINCT FROM auth.uid()
          OR public.is_service_role()
          OR public.is_admin_or_staff()) THEN
    RETURN false;
  END IF;

  -- Kdo provoz řídí, vidí všechno.
  IF public.is_admin_or_staff(p_uid) THEN
    RETURN true;
  END IF;

  -- Ungated: žádná deklarace = žádné omezení.
  IF p_audience IS NULL OR p_audience = '{}'::jsonb THEN
    RETURN true;
  END IF;

  -- Neznámý klíč = DENY (viz hlavička). Kontroluje se PŘED vyhodnocením, aby
  -- deklarace `{"roles":[…], "rols":[…]}` neprošla po první rozpoznané ose.
  FOR v_key IN SELECT jsonb_object_keys(p_audience) LOOP
    IF v_key NOT IN ('roles', 'min_tier', 'udeleni') THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Osa ROLE: stačí jedna z vyjmenovaných. Hodnota mimo enum app_role nikdy
  -- nematchne (has_role srovnává role::text = p_role) — proto je prázdné pole
  -- deklarace, kterou nikdo nesplní, a je to tak zamýšlené.
  IF p_audience ? 'roles' THEN
    IF jsonb_typeof(p_audience->'roles') <> 'array' THEN
      RETURN false;
    END IF;
    FOR v_role IN SELECT jsonb_array_elements_text(p_audience->'roles') LOOP
      IF public.has_role(p_uid, v_role) THEN
        v_role_hit := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_role_hit THEN
      RETURN false;
    END IF;
  END IF;

  -- Osa ÚROVEŇ ÚČASTI: deleguje na existující tier mašinerii (2-arg forma má
  -- vlastní NULL guard a fail-closed odvození úrovně).
  IF p_audience ? 'min_tier' THEN
    v_min_tier := nullif(p_audience->>'min_tier', '');
    IF v_min_tier IS NULL THEN
      RETURN false;
    END IF;
    IF NOT COALESCE(public.audience_user_meets_tier_requirement(v_min_tier, p_uid), false) THEN
      RETURN false;
    END IF;
  END IF;

  -- Osa UDĚLENÍ: uživatel má na sekci udělení (zapisuje jen surface_udel_admin).
  IF p_audience ? 'udeleni' THEN
    v_sekce := p_audience->>'udeleni';
    IF jsonb_typeof(p_audience->'udeleni') <> 'string' OR v_sekce !~ '^[a-z][a-z0-9_]*$' THEN
      RETURN false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.surface_section_grants g
                    WHERE g.user_id = p_uid AND g.surface = v_sekce) THEN
      RETURN false;
    END IF;
  END IF;

  -- Všechny deklarované osy prošly.
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.surface_audience_allows(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surface_audience_allows(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.surface_audience_allows(uuid, jsonb) TO service_role;
