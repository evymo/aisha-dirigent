-- Function: public.li_finding_question_id
-- Identita DOTAZU NA PRAVDU nad nálezy: jedno pravidlo × jeden druh nálezu.
--
-- Deterministická (md5 → uuid), aby ji čtecí blok vydal i pro dotaz, na který
-- ještě nikdo neodpověděl a který proto nemá řádek v li_finding_verdicts —
-- a zápisová větev z ní pak poznala, o jaký dotaz jde. Jediné místo výpočtu:
-- čtení (get_finding_questions) i zápis (submit_evidence_review_audited) ji
-- volají, aby se klíč nemohl rozejít.
--
-- rule_key smí být NULL (starší nálezy bez rule_id) — skládá se jako ''.

create or replace function public.li_finding_question_id(p_rule_key text, p_finding text)
returns uuid
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select md5('finding-question|' || coalesce(p_rule_key, '') || '|' || coalesce(p_finding, ''))::uuid;
$$;

revoke all on function public.li_finding_question_id(text, text) from public, anon;
grant execute on function public.li_finding_question_id(text, text) to authenticated, service_role;
