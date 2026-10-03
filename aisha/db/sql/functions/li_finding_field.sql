-- Function: public.li_finding_field
-- Jedno pole dotazu na pravdu ve tvaru RecordField {key, label_key, value}.
--
-- Hodnota smí být podle kontraktu jen text, číslo nebo null. Důkaz z ingestu je
-- jsonb libovolného tvaru, takže číslo zůstane číslem (klient ho naformátuje)
-- a všechno ostatní jde jako text — objekt nebo pole by shodilo celou frontu.
-- Chybí-li klíč nebo popisek, vrací NULL a volající pole vynechá.

create or replace function public.li_finding_field(p_key text, p_label_key text, p_value jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when nullif(p_key, '') is null or nullif(p_label_key, '') is null then null
    else jsonb_build_object(
      'key',       p_key,
      'label_key', p_label_key,
      'value',     case
                     when p_value is null or jsonb_typeof(p_value) = 'null' then 'null'::jsonb
                     when jsonb_typeof(p_value) in ('number', 'string') then p_value
                     else to_jsonb(p_value::text)
                   end)
  end;
$$;

revoke all on function public.li_finding_field(text, text, jsonb) from public, anon;
grant execute on function public.li_finding_field(text, text, jsonb) to authenticated, service_role;
