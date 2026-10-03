-- Trigger: li_doc_scope_keys_nase_firmy
-- Tabulka: li_doc_scope_keys (po příkazu, tabulka přechodu `nove`)
-- Funkce: fn_li_doc_scope_keys_nase_firmy — nová instance zdroje → návrh „naše firma“
DROP TRIGGER IF EXISTS li_doc_scope_keys_nase_firmy ON public.li_doc_scope_keys;
CREATE TRIGGER li_doc_scope_keys_nase_firmy
  AFTER INSERT ON public.li_doc_scope_keys
  REFERENCING NEW TABLE AS nove
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_li_doc_scope_keys_nase_firmy();
