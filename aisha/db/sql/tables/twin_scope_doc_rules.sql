-- =============================================================================
-- twin_scope_doc_rules — jak VAZBA osoby na identitu zakládá nárok na DOKLAD.
--
-- ⭐ PROČ (rozhodnutí majitele 2026-09-28). Oprávnění neplyne z role, ale z toho,
-- s čím je uživatel spojen: účet → osoba (potvrzená vazba účtu) → platná vazba
-- osoby na identitu (twin_relations) → doklady té identity. Běžný uživatel tak
-- v sekci vidí jen data, na která má nárok; přístup do sekce je zvlášť.
--
-- Řádek říká: „vazba druhu `relation_kind` pouští doklady typu `doc_type`,
-- jejichž pole `field_key` se rovná POTVRZENÉMU identifikátoru identity některého
-- z druhů `ref_kinds`". Příklad (data instance, ne jádro):
--   spravuje · invoice  · owner_company · {company_name}
--   spravuje · contract · supplier_id   · {company_ico}
-- Porovnává se s identifikátory (twin_external_refs, state=confirmed, platné),
-- ne s názvem dvojčete: o tom, čím se identita pozná, rozhoduje člověk (HR),
-- ne shoda textu. Druhy vazeb i klíče polí jsou slovník instance.
--
-- ⛔ Prázdná tabulka = nikdo nic nepustí (fail-closed), ne „všichni všechno".
-- ⛔ Přístup jen přes funkce (li_doc_slugs_v_rozsahu, twin_ids_v_rozsahu) a data
-- instance; RLS bez politik, žádné granty pro anon/authenticated.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.twin_scope_doc_rules (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  relation_kind  text        NOT NULL CHECK (btrim(relation_kind) <> ''),
  doc_type       text        NOT NULL CHECK (btrim(doc_type) <> ''),
  field_key      text        NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]*$'),
  ref_kinds      text[]      NOT NULL CHECK (cardinality(ref_kinds) > 0),
  is_active      boolean     NOT NULL DEFAULT true,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twin_scope_doc_rules_unique UNIQUE (relation_kind, doc_type, field_key)
);

COMMENT ON TABLE public.twin_scope_doc_rules IS
  'Nárok z vazeb: druh vazby osoby na identitu × typ dokladu × pole dokladu × druhy potvrzených identifikátorů identity. Slovník instance; prázdno = nikdo nic.';

ALTER TABLE public.twin_scope_doc_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.twin_scope_doc_rules FROM PUBLIC, anon, authenticated;
