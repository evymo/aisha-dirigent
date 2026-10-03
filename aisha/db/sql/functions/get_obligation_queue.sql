-- Data RPC for a 'review_queue' block: obligations awaiting human confirmation,
-- from the local-ingest evidence silo (li_obligations). Legal content is born
-- NEEDS_REVIEW and is never authoritative without a human (li_obligations schema
-- doctrine); this queue is where a reviewer confirms it. SECURITY INVOKER.
--
-- Global on the console; scoped to one document via p_params->>'doc_slug'
-- (or 'document_id' alias). Each item carries `id` = li_obligations.id (uuid) —
-- the entity_id submit_evidence_review_audited('obligation', id, ...) mutates.
-- The verbatim quote + clause_ref travel with every item: without them an
-- obligation is a claim, not evidence (provenance doctrine).
--
-- p_params->>'limit' caps the page (default 100, max 500), newest first. Naměřeno
-- 2026-09-23 na produkci: bez stropu vydávala konzole všech 3 909 závazků =
-- 2,8 MB v jedné odpovědi, v sekci Smlouvy i Workbench, při každém otevření.
-- Pořadí stránky i položek je (ingested_at desc, clause_ref, id) — dřív se
-- výsledek řadil podle náhodného uuid, takže „nejnovější" nebylo nahoře.
--
-- Contract: (jsonb) -> jsonb {data:{entity_kind:'obligation', items[], actions[]}, provenance}.

create or replace function public.get_obligation_queue(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with items as (
    select
      o.id::text                                     as id,
      coalesce(o.action, o.clause_title, o.clause_ref) as title,
      o.quote,
      o.clause_ref,
      o.obliged_party,
      o.deadline_text,
      o.consequence_text,
      o.updated_at,
      o.ingested_at
    from public.li_obligations o
    where o.candidate_status = 'NEEDS_REVIEW'
      and (coalesce(p_params->>'doc_slug', p_params->>'document_id') is null
           or o.doc_slug = coalesce(p_params->>'doc_slug', p_params->>'document_id'))
      -- Osa „podle firmy" (2026-09-28): závazek patří firmě přes SVŮJ doklad. Bez
      -- `superseded_by` záměrně — výřez má být přesná podmnožina fronty bez osy,
      -- a ta ukazuje i závazky ze starší verze dokladu.
      and (nullif(p_params->>'owner_company', '') is null
           or exists (select 1 from public.li_source_registry r
                       where r.source_sha256 = o.source_sha256
                         and r.fields->'owner_company'->>'value' = p_params->>'owner_company'))
    order by o.ingested_at desc nulls last, o.clause_ref, o.id
    limit least(greatest(coalesce(nullif(p_params->>'limit', '')::int, 100), 1), 500)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'entity_kind', 'obligation',
      'items', coalesce(jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'title', coalesce(items.title, items.clause_ref),
          'subtitle_key', 'app.wb.review.needs_review',
          'state', 'needs_review',
          'quote', items.quote,
          'fields', jsonb_build_array(
            jsonb_build_object('key', 'obliged_party', 'label_key', 'app.wb.field.obliged_party', 'value', items.obliged_party),
            jsonb_build_object('key', 'deadline',      'label_key', 'app.wb.field.deadline',      'value', items.deadline_text),
            jsonb_build_object('key', 'consequence',   'label_key', 'app.wb.field.consequence',   'value', items.consequence_text),
            jsonb_build_object('key', 'clause',        'label_key', 'app.wb.field.clause',        'value', items.clause_ref)
          )
        )
        order by items.ingested_at desc nulls last, items.clause_ref, items.id
      ), '[]'::jsonb),
      'actions', jsonb_build_array(
        jsonb_build_object('action_key', 'app.wb.action.approve', 'decision', 'HUMAN_CONFIRMED', 'intent', 'approve'),
        jsonb_build_object('action_key', 'app.wb.action.reject',  'decision', 'REJECTED',        'intent', 'reject')
      )
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-obligations',
      'freshness_at', to_char(coalesce(max(items.updated_at), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'obligation-queue'
    ) || public.scope_applied(p_params, 'owner_company')
  )
  from items;
$$;

revoke all on function public.get_obligation_queue(jsonb) from public, anon;
grant execute on function public.get_obligation_queue(jsonb) to authenticated, service_role;
