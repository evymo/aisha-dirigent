-- ============================================================================
-- Source of Truth: set_surface_section_override_admin
-- Popis: JEDINÝ zapisovatel zákaznických úprav navigace. Administrace mění
--        sekci PATCHEM s uzavřenou množinou klíčů; neznámý klíč RAISE (uložit
--        nepochopené = trvalý neviditelný překlep). Prázdný patch {} = RESET
--        na šablonu (smazání override) — reset musí být jedna čitelná akce.
--
--        Jména NIKDY textem: title_key/group_key/reason_key jsou KLÍČE do
--        `translations`. Přejmenování sekce = upsert_translation pod klíčem +
--        (volitelně) tento override, pokud má sekce dostat klíč vlastní.
--
--        Optimistické zamykání po vzoru set_system_config_admin:
--        p_expected_updated_at chrání proti přepsání cizí souběžné změny.
-- Bezpečnost: SECURITY DEFINER + admin-only (nastavení instance, ne provoz).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_surface_section_override_admin(
  p_surface             text,
  p_patch               jsonb DEFAULT '{}'::jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid  := auth.uid();
  v_patch   jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_stray   text;
  v_current timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_surface IS NULL OR btrim(p_surface) = '' THEN
    RAISE EXCEPTION 'surface cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- Override bez šablony nemá k čemu patřit: FK by to shodil i tak, ale tahle
  -- hláška říká PROČ — sekci nejdřív deklaruje overlay, teprve pak se ladí.
  IF NOT EXISTS (SELECT 1 FROM public.surface_sections s WHERE s.surface = p_surface) THEN
    RAISE EXCEPTION 'section % is not declared by the instance template', p_surface
      USING ERRCODE = 'P0002';
  END IF;

  SELECT string_agg(k, ', ') INTO v_stray
    FROM jsonb_object_keys(v_patch) k
   WHERE k NOT IN ('title_key','icon','group_key','group_order','position','state','reason_key');
  IF v_stray IS NOT NULL THEN
    RAISE EXCEPTION 'unknown override key(s): %', v_stray USING ERRCODE = '22023';
  END IF;

  SELECT o.updated_at INTO v_current
    FROM public.surface_section_overrides o WHERE o.surface = p_surface;

  IF p_expected_updated_at IS NOT NULL
     AND v_current IS NOT NULL
     AND v_current IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'concurrent modification: override changed at %', v_current
      USING ERRCODE = '40001';
  END IF;

  IF v_patch = '{}'::jsonb THEN
    DELETE FROM public.surface_section_overrides WHERE surface = p_surface;
  ELSE
    INSERT INTO public.surface_section_overrides AS o
      (surface, title_key, icon, group_key, group_order, position, state, reason_key, updated_at, updated_by)
    VALUES (
      p_surface,
      v_patch->>'title_key',
      v_patch->>'icon',
      v_patch->>'group_key',
      (v_patch->>'group_order')::int,
      (v_patch->>'position')::int,
      v_patch->>'state',
      v_patch->>'reason_key',
      now(), v_uid)
    ON CONFLICT (surface) DO UPDATE SET
      -- PATCH sémantika: klíč nepřítomný v patchi ponechá dosavadní hodnotu,
      -- klíč s JSON null ji vrací šabloně. Bez toho by každý zápis musel
      -- opakovat celý override a dvě okna administrace by si přepisovala osy.
      title_key   = CASE WHEN v_patch ? 'title_key'   THEN v_patch->>'title_key'   ELSE o.title_key   END,
      icon        = CASE WHEN v_patch ? 'icon'        THEN v_patch->>'icon'        ELSE o.icon        END,
      group_key   = CASE WHEN v_patch ? 'group_key'   THEN v_patch->>'group_key'   ELSE o.group_key   END,
      group_order = CASE WHEN v_patch ? 'group_order' THEN (v_patch->>'group_order')::int ELSE o.group_order END,
      position    = CASE WHEN v_patch ? 'position'    THEN (v_patch->>'position')::int    ELSE o.position    END,
      state       = CASE WHEN v_patch ? 'state'       THEN v_patch->>'state'       ELSE o.state       END,
      reason_key  = CASE WHEN v_patch ? 'reason_key'  THEN v_patch->>'reason_key'  ELSE o.reason_key  END,
      updated_at  = now(),
      updated_by  = v_uid;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_uid, 'surface.section_override_set',
          jsonb_build_object('surface', p_surface, 'patch', v_patch));

  RETURN jsonb_build_object('ok', true, 'surface', p_surface,
                            'reset', v_patch = '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.set_surface_section_override_admin(text, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_surface_section_override_admin(text, jsonb, timestamptz) TO authenticated, service_role;
