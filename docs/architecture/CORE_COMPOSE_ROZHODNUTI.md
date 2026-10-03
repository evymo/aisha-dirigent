# Core compose — proč je co tak, jak je

> Přesunuto z `docker-compose.coolify.yml` (2026-08-23). Compose nese KONFIGURACI;
> odůvodnění patří sem. Každý blok níž stál nějaký naměřený incident — nejsou to
> poznámky, ale zápisy z ladění.

## `(hlavička souboru)`

Prose lives in docs/compose-notes/docker-compose.coolify.yml.md — this file is shipped to the
server as a command-line argument and competes with ARG_MAX, so it carries
configuration only. Add explanations there, anchored to the line they explain.

## `minio-init`

Phase 12 WP 3.8 — supply-chain SBOM archive (CycloneDX JSON), pushed by
dependency-security.yml; unbounded retention. Path aisha-sbom-artifacts/.

## `minio-init`

Consolidated shared MinIO (one per tenant). Loki bucket names below MUST
match coolify/observability/loki/loki-config.yaml (else NoSuchBucket crash).

## `minio-init`

SBOM/langfuse/loki buckets are INTERNAL-only (no anonymous download).

## `migrate`

⛔ NAMĚŘENO 2026-08-19: `docker-migrate-entrypoint.sh` volá při
provisioningu operátorů a vydavatelského klienta Keycloak — a když mu
adresu nikdo nedal, dosazoval si `http://aisha-keycloak:80`, tedy
Keycloak CIZÍ instance. Entrypoint ji teď VYŽADUJE; doručit ji musí
tenhle deklarační bod, ne domněnka v konzumentovi.

## `db`

⛔ `image:` tu BÝT NESMÍ. Nasazovací cesta si postavený obraz tavuje sama
(`<app-uuid>_<služba>:<commit>`), takže připnutý lokální tag se s ním nikdy
nepotká — `up` ho zkusí stáhnout (není odkud) a pak postavit v adresáři,
kde repo není. Naměřeno 2026-08-17 i 2026-08-09; hlídá brána
src/tests/gates/obraz-musi-nekdo-vyrobit.gate.test.ts. Kontext zůstává úzký
(viz hlavička infra/postgres/Dockerfile — celý repo shodil DinD rouru v CI).

## `pgbackrest`

Týž build jako `db` (kotva výš) — obě služby musejí stát na témž Dockerfilu,
aby sdílely UID postgresu a měly pgbackrest ve stejné verzi. `image:` tu
z téhož důvodu jako u `db` NENÍ: obraz tavuje nasazovací cesta.

## `imgproxy`

⛔ ALIAS S IDENTITOU (2026-08-21): cíl mesh trasy se skládá jako
`<prefix>-<služba>`, ale Coolify `container_name` PŘEPISUJE — nosný je
ALIAS. Bez něj trasa míří na jméno, které neexistuje, a ingress vrací 502,
přestože mesh sama je průchozí. Sítě dědí kotva; tohle k nim přidá jméno.

## `web`

Přihlašovací údaj pro sentry-cli (vytvoří release při buildu). Do
prohlížečového bundlu nepatří a do metadat obrazu už vůbec — proto
secret, ne arg.

## `svc-web-artifact`

NE build arg — viz komentář u secrets na konci souboru.

## `svc-web-artifact`

Odchozí brána do meshe (proč: docs/architecture/MESH_EGRESS.md).

## `netbird-agent`

RETRY LOOP — NOT `exec`. If `netbird up` exits (mesh/PKI outage), exec'd
PID 1 death → container restart → RestartCount climbs → Coolify restart-limit
kills the WHOLE aisha-core app ("core vanish"). Staying alive keeps
RestartCount=0 so a sidecar mesh outage can never down the stack.

## `core-mesh-ingress`

Caddyfile se STAVÍ ZA BĚHU z proměnné. Dřív tu byl ručně psaný seznam,
kde PORT byl směrovací klíč — takže dvě služby na jednom portu se
vylučovaly (změřeno: imgproxy × n8n na :8080) a seznam se rozcházel
s katalogem. Rozlišuje se HOSTEM, takže na portu smí být kolik chce.

## `core-mesh-ingress`

seskupit podle portu; jeden blok na port, uvnitř @host matchery

## `core-mesh-ingress`

Blok MUSÍ být víceřádkový: caddyfile odmítá `{` a obsah na jednom
řádku („Unexpected next token after '{' on same line"). Jednořádkový
tvar prošel mým testem, protože jsem ověřoval scripts/gen-mesh-ingress.mjs
— DRUHOU implementaci téhož, která píše víceřádkově. Běžela ale tahle.

## `core-mesh-ingress`

Bez shody se NEHÁDÁ: 421 řekne volajícímu, že Host sem nepatří.
Tiché přeposlání na "první" službu by z chybného jména udělalo
funkční požadavek na CIZÍ data.

## `core-mesh-ingress`

Build-time tajemství. Zdroj `environment:` čte proměnnou z prostředí projektu,
tedy i z `.env`, který Coolify pro build zapisuje — ověřeno měřením
2026-08-15 i s proměnnou úmyslně odstraněnou z procesního prostředí.

Obě proměnné MUSÍ být v Coolify runtime-only. Build-time příznak dělá dvě věci
najednou: pošle hodnotu jako `--build-arg` A nechá ji vložit jako `ARG` za
každý `FROM`. Obojí ji zapíše do `docker history`, odkud ji přečte kdokoli
s přístupem k obrazu. Naměřeno na aisha-core: 190 zapečených přiřazení,
každé tajemství pětkrát. Přes secret 0.
