---
name: aisha-cold-start
description: Diagnose and run AISHA stack cold-start bring-up — Coolify prod provisioning (aisha-cold-start.sh) and the local mirror (local-warmup.sh), topology via derive-domains, doctor preflight phases A–I, federation gates (source-broker), and OpenClaw executor wiring. Use when a cold start fails, when running a fresh coolify deploy, or when debugging preflight/doctor/topology issues. Triggers on "cold start", "cold-start", "bring-up", "doctor", "doctor phase", "federation gate", "openclaw", "derive-domains", "topology", "preflight", "local mirror", "coolify deploy", "wipe", "OPENCLAW_URL".
---

# AISHA Cold-Start Skill

V tomto repu **cold-start ≡ end-to-end provisioning celého AISHA stacku od nuly** — buď na Coolify clusteru (prod, `scripts/aisha-cold-start.sh`), nebo jako lokální mirror na dev stroji (`scripts/local-warmup.sh`). Prod cesta čte topologii z resolveru: service catalog + deployment profile → `scripts/lib/derive-domains.mjs`. **Lokální mirror NE** — `local-compose-gen.mjs` staví z `config/local-presets.mjs` a `services.json` se nedotkne (ověřeno 2026-09-05: nemá ho ani mezi importy). Do té doby tu stálo „obě cesty čtou stejnou topologii", což byl sdílený zdroj pravdy, který sdílený není — a znamená to, že topologické vady (služba v manifestu mimo topologii) lokální bring-up NECHYTÍ. Cold-start je **destruktivní generační operace** (s `--wipe` maže apps i volumes) — proto před ním vždy běží read-only doctor preflight a po něm read-only verify.

Tento skill pokrývá: topologické primitivy, doctor fáze, federation gates, OpenClaw wiring a známé failure módy. Operační detail je v runbooku [docs/deploy/COLD_START_RUNBOOK.md](../../../docs/deploy/COLD_START_RUNBOOK.md) a topologie v [docs/deploy/STACK_TOPOLOGY.md](../../../docs/deploy/STACK_TOPOLOGY.md).

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Prod cold-start selhal / diagnostika před spuštěním | **Ano** — začni doctorem |
| Bring-up lokálního mirroru (preset, generator pipeline) | **Ano** |
| Topologie: nový service v katalogu, `<ID>_URL` primitive, profil | **Ano** |
| Federation gate (source-broker se ne/deployuje) | **Ano** |
| OpenClaw wiring (adapter se self-enabluje / ne-enabluje) | **Ano** |
| B/G deploy, rollback, drift observer, Sentry observer | **Ne** — viz `aisha-deploy-flow` skill |
| DB migrace, baseline, seed po cold-startu | **Ne** — viz `aisha-migration` skill |
| n8n workflow (WF_*) obsah/bootstrap logika | **Ne** — viz `aisha-n8n-workflow` skill |

## Topologie — derive-domains primitive

Jediný zdroj pravdy pro „co běží, kde a na jaké URL":

- **`config/services.json`** — katalog služeb: `id`, `tier` (`required|important|optional|local-only`), `subdomain`, `compose`, `placement`, `depends_on`, `internal_url` (container + port).
- **`config/profiles/*.json`** — deployment shape: `cloud-multi` (prod, 3 servery), `cloud-single`, `local-dev`. Profil určuje TLD patterny, servery, `tier_filter`, `include`/`exclude`.
- **`scripts/lib/derive-domains.mjs`** — deterministický resolver. CLI:

```bash
node scripts/lib/derive-domains.mjs --shell   # bash exporty (cold-start je source-uje)
node scripts/lib/derive-domains.mjs --json    # pro tooling/testy
node scripts/lib/derive-domains.mjs --check   # sanity-check, exit 1 při nekonzistenci
node scripts/lib/derive-domains.mjs --profile=local-dev --mesh=off
```

**Internal `<ID>_URL` primitive (B6, #19):** `formatShellExports` emituje `<ID>_URL=http://<container>:<port>` pro každý katalogový service s `internal_url` (např. `OPENCLAW_URL`, `EXEC_URL`, `INTEGRATION_URL`) + legacy aliasy (`AGENT_RUNNER_URL`→exec, `RAGNAROK_URL`→integration). Programaticky: `internalUrlFor(serviceId)`. Nikdy nehardcoduj `http://aisha-xyz:port` do compose/skriptů — přidej `internal_url` do katalogu. Uzavřeno gatem `src/tests/gates/internal-url-topology.gate.test.ts`.

Hostname literály (`.backend.id3a.cz` apod.) patří jen do profile JSON / `config/domains.env` — nikam jinam (hlídá `src/tests/gates/domain-coverage.gate.test.ts`).

## Prod cold-start (Coolify) — kanonický flow

```bash
bash scripts/cold-start-doctor.sh              # 0. preflight (read-only)
bash scripts/aisha-cold-start.sh --dry-run     # 1. plán
bash scripts/aisha-cold-start.sh               # 2. cold-start (doctor je step 0)
bash scripts/aisha-cold-start.sh --wipe        # DESTRUKTIVNÍ: smaže apps + volumes
npm run cold-start:verify                      # 3. read-only verify po deployi
npm run stack:health:prod
bash scripts/smoke-routing.sh
```

Kroky orchestrace (detailní tabulka v runbooku): 0 doctor → 1 safety check → 2 generate secrets (`scripts/generate-secrets.mjs` → `.env.coolify`) → 2b compose preflight (`scripts/preflight-compose.sh`) → 3 create apps (`scripts/coolify-story-init.sh` dle `coolify/manifests/aisha.manifest`) → 4 env vars per stack (`scripts/coolify-deploy-init.sh`) → 5 wave redeploy (`scripts/aisha-redeploy.mjs`, snapshoty v `.coolify-deploy-snapshots/`) → 6 bootstrap (KC realm, n8n) → 7 summary.

**Validate-before-destroy invariant:** při `--wipe` je destroy ODLOŽEN až za generate+validate (step 2/2b). Config/secret chyba tedy abortuje, dokud stará platforma ještě žije — nikdy „wiped-but-undeployed". Escape hatche: `--keep-volumes` (riziko crypto-state mismatch — starý PKI volume nejde dešifrovat novým `PKI_DEFAULT_SECRET`), `--skip-orphan-cleanup` (debug).

## Doctor — preflight fáze

`scripts/cold-start-doctor.sh` je **read-only** preflight; exit `0` ready / `1` fatal / `2` warn-only.

```bash
bash scripts/cold-start-doctor.sh                 # full
bash scripts/cold-start-doctor.sh --no-network    # bez API/git checků
bash scripts/cold-start-doctor.sh --phase A,B,C   # jen vybrané fáze
```

| Fáze | Co ověřuje |
|---|---|
| A | Environment vars (GIT_TOKEN — povinný se soukromým overlayem, COOLIFY_API_KEY, server UUIDs) |
| B | Files (manifest, compose, infra) |
| C | Env contract — `scripts/aisha-env-doctor.mjs --report` |
| D | Compose interpolation — `scripts/preflight-compose.sh` |
| E | Manifest ↔ compose bidirectional match |
| F | Coolify API connectivity |
| G | Git host (origin) connectivity |
| H | Federation readiness (source-broker) — no-op když `SOURCE_API_URL` unset |
| I | OpenClaw wiring — statický 4-SoT koherence check (viz níže) |

Timeouty jsou tunable přes `config/cold-start-timeouts.env`.

## Federation gates (source-broker)

Federation stack `docker-compose.coolify-source-broker.yml` je **opt-in** — deployuje se JEN když je nastaveno `SOURCE_API_URL`. Gate je zrcadlený na 4 místech (všechna musí souhlasit, jinak false-fail):

1. **Deploy-side gate** — `scripts/coolify-story-init.sh` (řádek ~380): role `source-broker` se přeskočí, když `SOURCE_API_URL` unset.
2. **Preflight mirror** — `scripts/preflight-compose.sh`: federation compose se nevaliduje (chyběly by operator `SOURCE_*` secrets).
3. **Count-check** — `scripts/aisha-cold-start.sh` (step 3 verify): `expected_count` se snižuje o federation apps, jinak by non-federated cold-start abortoval na „found N-1 < N".
4. **Doctor Phase H** — clean PASS no-op pro non-federated fork; při zapnuté federaci kontroluje compose + manifest + `KC_ALLOWED_CLIENTS` + že `BROKER_DEV_ALLOW_UNAUTHED_SYNC` NENÍ true v produ.

Přidáváš-li další opt-in stack, replikuj tenhle vzor na všech čtyřech místech najednou.

## OpenClaw wiring

OpenClaw (`config/services.json` id `openclaw`, tier `optional`, container `aisha-openclaw`, compose `docker-compose.coolify-openclaw.yml`, manifest app `openclaw:backend`) je advisory planner + sandbox — NE náhrada n8n ani MCP. Adapter v `services/svc-ai-chat/src/reflection/runtime/adapters.ts` se **self-enabluje ODVOZENĚ** — `isAvailable()` je true jen když v runtime resolvují `OPENCLAW_URL` + `OPENCLAW_API_KEY` (+ `LANGGRAPH_ENABLE_OPENCLAW`). Žádný seed flip.

Doctor Phase I proto staticky ověřuje koherenci celého řetězu, který ty dvě hodnoty rodí:

1. **Birth** — `scripts/generate-secrets.mjs` mintuje `OPENCLAW_API_KEY` (shared bearer svc-ai-chat ↔ svc-openclaw).
2. **Contract** — `scripts/aisha-env-doctor.mjs` deklaruje `OPENCLAW_API_KEY` + `OPENCLAW_URL`.
3. **Compose** — `docker-compose.coolify-ai-chat.yml` předává obě vars a `SSRF_HOST_ALLOWLIST` obsahuje `aisha-openclaw` (jinak adapter narazí na SSRF guard).
4. **Topology** — katalogové `internal_url` → derive-domains emituje `OPENCLAW_URL`.

Chybějící optional executor = INFO (`OPENCLAW_URL` se rodí až při cold-startu ze source-nuté topologie). HALF-wired stav (část SoTs souhlasí) = FAIL — jinak by ho adapter tiše schoval jako „openclaw disabled".

**Local mirror:** `config/profiles/local-dev.json` má `"include": ["openclaw"]` (tier:optional by ho `tier_filter` jinak vyhodil), takže lokální stack zrcadlí cloud-multi. Presety s openclaw: `optimum-ai`, `full-light`, `full` v `config/local-presets.mjs` (subdomain `companion`).

## Lokální mirror (dev bring-up)

```bash
npm run dev:stack            # local-warmup.sh --preset optimum --seed-profile dev
npm run stack:bringup        # non-interactive + --wait + --json (pro agenty/CI)
bash scripts/local-warmup.sh --preset optimum-ai   # + svc-ai-chat + openclaw executor
npm run dev:stack:down       # tear-down (containers + volumes + network)
npm run stack:health:local
```

Pipeline: `coolify/manifests/aisha.manifest` → `scripts/local-compose-gen.mjs --preset X` (transformace: coolify network → `aisha-local`, volume rename, drop traefik labels, host port mapping, domain rewrite na `http://localhost:<port>`) → `docker-compose.local.generated.json` (gitignored) → `docker compose up -d`. Presety a cross-stack dependency graf žijí v `config/local-presets.mjs`.

Pozor: `docker-compose.local.yml` NENÍ generovaný local stack — je to doplněk jen pro profily `insight` (Elasticsearch/Ragnarok/Maestro) a `vllm` (GPU).

## Common pitfalls

❌ Hardcode `http://aisha-x:port` v compose/skriptu → přidej `internal_url` do `config/services.json`, gate `internal-url-topology` to jinak chytí
❌ `--wipe --keep-volumes` bez rozmyslu → stale PKI volume nejde dešifrovat novým secretem (crypto-state mismatch)
❌ Spuštění s `--skip-doctor` → přeskočí i federation/OpenClaw koherence checky
❌ Nový workspace package v Docker service bez build-chainu → `services/svc-ai-chat/Dockerfile` a `services/svc-mcp-knowledge/Dockerfile` musí explicitně buildit `@aisha/flowboard-core` (prod cold-start incident, PR #555)
❌ Nový opt-in stack gatovaný jen v story-init → count-check a preflight false-failnou (viz federation, PR #555)
❌ Řešení `mcp.aisha.guru`/`db.aisha.guru` aliasů přes Backend Traefik labels → musí jít přes Frontend edge mesh-proxy (Coolify normalizuje service names `-`→`_`, cross-server alias skončí 503)
❌ Healthcheck na `localhost` v kontejneru → IPv6 `::1` past (n8n musí volat `http://127.0.0.1:5678/healthz`)
❌ Messaging wave fail „network declared as external" → vyčerpané Docker address pools; `bash scripts/fix-docker-network-pools.sh`, pak odebrat `KNOWN_BROKEN` v `scripts/aisha-redeploy.mjs`
❌ Ruční PATCH domén v Coolify UI → topology drift; kontroluj `node scripts/verify-topology-deployed.mjs --strict` a `npm run coolify:domains:check`, apply jen explicitně

## Gates / validace

```bash
bash scripts/cold-start-doctor.sh              # preflight A–I (exit 0/1/2)
node scripts/lib/derive-domains.mjs --check    # topologie sanity
npm run env:doctor:report                      # env contract (.env.coolify)
npm run test:gates                             # incl. internal-url-topology + domain-coverage gates
npm run pre-deploy:check                       # test:gates + coolify:domains:check
npm run cold-start:verify                      # post-deploy read-only verify (--json variant existuje)
npm run stack:health:prod                      # kanonické routy z config/domains.env
npm run coolify:domains:check                  # docker_compose_domains drift (apply: coolify:domains:apply)
```

## Související

- **`aisha-deploy-flow`** — drift detection, B/G orchestrace, rollback, dashboard (navazuje NA zdravý cold-startnutý stack)
- **`aisha-migration`** — DB baseline + migrace, které cold-start bootstrap aplikuje
- **`aisha-n8n-workflow`** — obsah workflows, které step 6 bootstrapuje
- [docs/deploy/COLD_START_RUNBOOK.md](../../../docs/deploy/COLD_START_RUNBOOK.md) — operační runbook + recovery scénáře
- [docs/deploy/STACK_TOPOLOGY.md](../../../docs/deploy/STACK_TOPOLOGY.md) — katalog/profil/resolver koncepty
- [docs/deploy/AUTONOMOUS_COLD_START_2026-05-10.md](../../../docs/deploy/AUTONOMOUS_COLD_START_2026-05-10.md) — historický incident log
