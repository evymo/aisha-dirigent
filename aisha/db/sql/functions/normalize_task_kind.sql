-- Function: public.normalize_task_kind  (T1 — non-ossifying task_kind normalizer)
-- The ONE normalizer for task_kind across the stack. Pure/IMMUTABLE: lower-case, trim, collapse
-- internal whitespace to '_'. Empty/NULL → 'chat' (the established resolver default, line 37 of
-- aisha_resolve_clow_backend: COALESCE(p_clow->>'task_kind','chat')) — so this is a no-op on the
-- existing clean vocabulary ('chat','classification','reasoning','extraction','embedding') and a
-- pure robustness win on dirty input ('Chat ' → 'chat', 'multi step' → 'multi_step').
--
-- DELIBERATELY NOT a closed set: any string maps to a normalized string. There is no enum / DOMAIN /
-- CHECK that could reject an unseen kind — the taxonomy stays OPEN and grows from reality
-- (ai_task_kind_registry is observed, not authoritative). This is the anti-ossification rule the
-- owner mandated ("abychom nikde nezatvrdli").

CREATE OR REPLACE FUNCTION public.normalize_task_kind(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    NULLIF(regexp_replace(lower(btrim(p_raw)), '\s+', '_', 'g'), ''),
    'chat'
  );
$$;

COMMENT ON FUNCTION public.normalize_task_kind(text) IS
  'T1: the single, pure task_kind normalizer (lower/trim/collapse-ws; empty→chat). Idempotent on the existing vocabulary; never rejects an unseen kind (taxonomy stays open).';

GRANT EXECUTE ON FUNCTION public.normalize_task_kind(text) TO authenticated, service_role;
