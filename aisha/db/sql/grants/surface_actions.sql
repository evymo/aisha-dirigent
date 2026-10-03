-- Grants: surface_actions — táž třída jako surface_data_rpcs (čtení pro
-- authenticated pod RLS, vše pro service_role, nic pro anon/public).
revoke all on public.surface_actions from public;
revoke all on public.surface_actions from anon;
grant select on public.surface_actions to authenticated;
grant all on public.surface_actions to service_role;
