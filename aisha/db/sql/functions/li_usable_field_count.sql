-- Počet POUŽITELNÝCH polí ve vytěžení (fields jsonb registru local-ingestu).
-- Použitelné = klíč, jehož 'value' není prázdná. Tvar hodnoty je
-- {"confidence":…, "raw":…, "value":…} — samotný počet klíčů by počítal
-- i vytěžení, kde brány všechno zamítly a zůstal jen obal.
-- Měřítko monotonicity v li_upsert_source_registry: porovnává se tímhle
-- číslem, ne bajty — dva různé exporty téhož dokladu se liší v raw_data
-- vždycky, ale o kvalitě vypovídá jen kolik polí přežilo brány.
CREATE OR REPLACE FUNCTION public.li_usable_field_count(p_fields jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT count(*)::integer
  FROM jsonb_each(COALESCE(p_fields, '{}'::jsonb)) AS f(key, val)
  WHERE NULLIF(val->>'value', '') IS NOT NULL;
$function$;

-- Helper volá li_upsert_source_registry zevnitř (definer kontext, exekuuje owner);
-- přímé volání nemá pro anon/PUBLIC důvod, authenticated ho může chtít v testech.
REVOKE ALL ON FUNCTION public.li_usable_field_count(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.li_usable_field_count(jsonb) TO authenticated, service_role;
