-- DRAFT — grants pro celou surface sérii (anon floor dle #566: žádný zápis, tady ani SELECT).
--
-- surface_sections + surface_section_overrides jedou stejným režimem jako zbytek
-- série: čte přihlášený (metadata navigace), zapisuje výhradně service_role —
-- šablonu deploy soubor, úpravy admin RPC. Žádný INSERT/UPDATE pro klienty.
revoke all on public.surface_data_rpcs, public.surface_blocks,
              public.surface_layouts, public.surface_snapshots,
              public.surface_sections, public.surface_section_overrides from public;
revoke all on public.surface_data_rpcs, public.surface_blocks,
              public.surface_layouts, public.surface_snapshots,
              public.surface_sections, public.surface_section_overrides from anon;

grant select on public.surface_data_rpcs, public.surface_blocks,
                public.surface_layouts, public.surface_snapshots,
                public.surface_sections, public.surface_section_overrides to authenticated;

grant all on public.surface_data_rpcs, public.surface_blocks,
             public.surface_layouts, public.surface_snapshots,
             public.surface_sections, public.surface_section_overrides to service_role;
