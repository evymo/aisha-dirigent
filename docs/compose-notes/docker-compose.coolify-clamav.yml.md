# docker-compose.coolify-clamav.yml — notes

Prose extracted from `docker-compose.coolify-clamav.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

==============================================================================
Coolify story: aisha-clamav (shared antivirus sidecar — flow-through scanner)
==============================================================================
A single hardened ClamAV (clamd) instance, reachable on the shared docker network
as `clamd:3310` (INSTREAM). It is the SHARED malware scanner for the content
pipeline: the upload path (storage-auth / svc-web-artifact) streams every upload
to it BEFORE the object is promoted to a durable bucket or vectorized, and (later)
the mailserver's attachment path can point at the same clamd.

Byte/file-stage AV — complementary to scanForInjection (prompt-injection text stage).
Verdicts are persisted via record_comm_av_scan_audited (fail-closed: clean advances,
infected/error never promotes or vectorizes).

NOT HTTP — no Traefik route, no host port. Reachable by the network alias `clamd`
(consumers point CLAMD_HOST at it; default `clamd`). clamd.conf (scan limits +
AlertEncrypted) is BAKED into the image (bake-not-bind; Coolify v4 ignores the
top-level `configs:` directive — see docker-compose.coolify-llm-gateway.yml). tier=optional.
==============================================================================

## `- clamav-data:/var/lib/clamav`

Persist the signature DB across restarts (otherwise freshclam re-downloads ~300 MB).

## `test: ["CMD-SHELL", "clamdscan --ping 1"]`

The image's clamdcheck.sh does `echo PING | nc localhost 3310` with NO read
timeout — BusyBox nc intermittently closes the socket before clamd's PONG
arrives, so it FLAPS unhealthy even while clamd is serving (verified
2026-06-30: clamdcheck.sh exit 1 while `clamdscan --ping 1` exit 0 at the
same instant). clamdscan --ping speaks clamd's protocol with proper framing
+ its own timeout — reliable. (clamd is TCP-only: TCPSocket 3310, no LocalSocket.)

## `internal:`

Both `internal` and `coolify` alias the external coolify network (avoid per-stack
bridges). clamav attaches via `internal`; the `clamd` alias resolves on the shared
network so both same-stack and cross-stack (mailserver) consumers can reach it.

## `- ${APP_NAME_PREFIX:?identita instance}-clamd`

INSTANČNÍ alias, ne holý `clamd`. clamav sdílenou síť POTŘEBUJE —
konzumuje ho jiný stack (domain-services: CLAMD_HOST) — takže ho
narozdíl od pki-db odpojit nelze. O to důležitější je jméno.

Holý `clamd` si na sdílené síti nárokoval i cizí nájemník (změřeno
2026-08-10) a Docker DNS mezi nimi střídal. U clamd je to horší než
u databází: protokol NEMÁ ŽÁDNOU autentizaci, takže `INSTREAM`
pošle OBSAH skenovaného souboru tomu, kdo zrovna odpoví. U redis/
MariaDB útok skončí na hesle — tady ne.

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

## `external: true`

EXTERNAL — zakládá ji táž warmup aplikace, se subnetem z MESH_DNS_SUBNET
(mesh-router si na téhle síti pinuje ipv4_address, takže rozsah musí být
náš, ne náhodný z Dockeru).
