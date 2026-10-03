# docker-compose.coolify-tcars.yml — notes

Mirror of `docker-compose.coolify-webdispecink.yml` (the fleet-import connector
pattern): pki-init seeds the CA bundle volume, the service joins `internal`
(coolify) + `mesh-dns`, health over local HTTP, secrets via env delivered by
coolify-sync-envs.

- `TCARS_API_URL` empty-string passthrough: compose forwards `""` when unset
  (the no-hardcoded-deployment-config gate forbids value `:-` fallbacks for
  deployment endpoints); the vendor default lives in `services/svc-tcars/src/config.ts`.
- Credentials primarily come from the secret store via `edge_app_secrets`
  (keys `tcars_cislo_smlouvy`/`tcars_username`/`tcars_password`); the
  `TCARS_*` envs here are the documented fallback for bootstrap.
- Opt-in: the service is provisioned only when `TCARS_CISLO_SMLOUVY` is set
  (`provision_when_env` in config/services.json) — tenants without T-cars
  never get the stack, mirroring `WD_KODF`.
- Port 3044 (webdispecink holds 3042).
