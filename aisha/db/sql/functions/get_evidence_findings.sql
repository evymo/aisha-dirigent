-- Data RPC for an 'alert_feed' block: deterministic cross-document findings from
-- the local-ingest evidence silo (li_findings) — price_mismatch, missing_counterpart,
-- date_out_of_window, missing_line_item. These are the discrepancies the ingest
-- consistency checks surface across documents. SECURITY INVOKER — li_findings RLS
-- decides visibility.
--
-- Optional filter p_params->>'severity' (high|medium|low). Ordered high→low then
-- most-recent, matching the li_list_findings read contract.
-- Contract: (jsonb) -> jsonb {data:{items[]}, provenance}.

create or replace function public.get_evidence_findings(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with items as (
    select
      f.id::text                                as id,
      f.finding                                 as finding,
      coalesce(f.severity, 'low')               as severity,
      coalesce(jsonb_array_length(f.documents), 0) as doc_count,
      f.documents,
      f.ingested_at
    from public.li_findings f
    where (p_params->>'severity' is null or f.severity = p_params->>'severity')
    order by case coalesce(f.severity, 'low')
               when 'high' then 1 when 'medium' then 2 else 3 end,
             f.ingested_at desc
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'items', coalesce(jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'title_key', 'app.wb.finding.' || items.finding,
          'severity', items.severity,
          'fields', jsonb_build_array(
            jsonb_build_object('key', 'documents', 'label_key', 'app.wb.field.documents', 'value', items.doc_count)
          ),
          'evidence', items.documents
        )
        order by case items.severity when 'high' then 1 when 'medium' then 2 else 3 end, items.id
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-findings',
      'freshness_at', to_char(coalesce(max(items.ingested_at), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'evidence-findings'
    )
  )
  from items;
$$;

revoke all on function public.get_evidence_findings(jsonb) from public, anon;
grant execute on function public.get_evidence_findings(jsonb) to authenticated, service_role;
