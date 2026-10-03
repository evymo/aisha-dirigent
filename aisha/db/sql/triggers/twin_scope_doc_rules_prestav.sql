-- Trigger: twin_scope_doc_rules_prestav
-- Source of truth pair: aisha/db/sql/functions/fn_twin_scope_doc_rules_prestav.sql
-- Za příkaz, ne za řádek: seed pravidel z dat instance přestaví klíče jednou.

DROP TRIGGER IF EXISTS twin_scope_doc_rules_prestav ON public.twin_scope_doc_rules;
CREATE TRIGGER twin_scope_doc_rules_prestav
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.twin_scope_doc_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_twin_scope_doc_rules_prestav();
