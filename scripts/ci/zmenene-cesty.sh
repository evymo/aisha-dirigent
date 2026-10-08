#!/usr/bin/env bash
# =============================================================================
# zmenene-cesty.sh — směrování podle změněných cest: JEDEN DOMOV pro CI i hook
# =============================================================================
# Vstup:  seznam změněných cest na stdin (jedna na řádek, relativně ke kořeni repa).
# Výstup: řádky `priznak=true|false` na stdout — tytéž klíče, které dřív krok
#         `Detect changed paths` v ci.yml zapisoval do $GITHUB_OUTPUT.
#         Diagnostika (seznam změn, souhrn směrování) jde na stderr.
# Kód:    0 = směrování určeno; 1 = směrování si protiřečí (fail-closed sebekontrola)
#         nebo vadné volání. Volající s kódem ≠ 0 NESMÍ nic přeskočit.
#
# PROČ SKRIPT, NE KROK V YAML
# Do 2026-09-25 žila pravidla inline v ci.yml. Pre-push hook je potřebuje taky
# (pouští jen brány a testy dotčených cest), a druhá kopie by se rozešla tiše —
# přesně třída vady, kterou tenhle soubor v komentářích níž popisuje třikrát
# (packages/ u `app`, heals.sql u `db_change`, `packages/` u `services_change`).
# Proto se pravidla NEKOPÍRUJÍ: ci.yml i hook volají tenhle skript a brány
# (mobil-bundle-univerzum, obsah-obrazu-db-spousti-cold-start, detektor-zna-edge,
# posun-submodulu-nenasazuje-core, smerovani-jeden-domov) čtou vzory ODSUD.
#
# ⛔ TVAR ŘÁDKŮ SMĚROVAČE JE KONTRAKT. Brány výše hledají řádky tvaru
#     grep -qE '^(…)' <<< "$CHANGED" && PRIZNAK=true || PRIZNAK=false
# a `case … ) EXPECT_X=true ;;` — kdo tvar změní, shodí je (a má je opravit
# spolu s tímhle souborem, ne obejít).
#
# ⛔ BEZ ROUR: `echo … | grep -q` končí na první shodě, zavře rouru, zapisovatel
# dostane SIGPIPE a pod `pipefail` je výsledek 141 → příznak by zhasl
# (naměřeno 2026-09-11 na runneru: 62 změněných src/ → app=false). Herestring
# rouru neotevírá vůbec, proto všude `<<< "$CHANGED"`.
# =============================================================================
set -u

# ─── Režim --seznam <base> <head>: SESTAVENÍ seznamu změn (týž domov jako pravidla) ───
# ⛔ NAMĚŘENO 2026-09-25 (recenze #1073, git 2.54): `git diff --name-only` má detekci
# přejmenování ZAPNUTOU, takže přesun `services/a/x.ts → docs/x.ts` vypíše JEN `docs/x.ts`.
# Směrovač pak neviděl services/ → services_change=false, v krajním případě docs_only=true:
# služba přišla o soubor a netestovala se ani nenasadila. `--no-renames` vypíše obě strany.
# `core.quotePath=false`: cesta s diakritikou by jinak přišla v uvozovkách a vzory `^src/`
# by ji minuly. Kód ≠ 0 = seznam NEZNÁMÝ — volající rozhoduje (CI: záchranná síť,
# pre-push: plná sada), nikdy ne prázdný seznam vydávaný za „nic se nezměnilo".
if [ "${1:-}" = "--seznam" ]; then
  [ $# -eq 3 ] || { echo "použití: zmenene-cesty.sh --seznam <base> <head>" >&2; exit 64; }
  exec git -c core.quotePath=false diff --name-only --no-renames "$2" "$3"
fi

if [ -t 0 ]; then
  echo "zmenene-cesty.sh: očekává seznam změněných cest na stdin (jedna na řádek)" >&2
  exit 1
fi
CHANGED=$(cat)
# Prázdné řádky ven, ať `wc -l` i sebekontrola počítají skutečné cesty.
CHANGED=$(grep -v '^[[:space:]]*$' <<< "$CHANGED" || true)

# Submoduly (`.gitmodules`) jsou cizí repa, NE vstupy vite buildu: posun gitlinku
# `packages/local-ingest` nesmí rozsvítit `app` (testy webu + Deploy Core/Edge).
# Naměřeno 2026-09-14: každý bump ingestu přestavěl databázi, zatímco appku,
# která se měnila, detektor nenašel. Kam submodul patří, určuje
# aisha-changed-apps.mjs z COPY v Dockerfile (krok deploy_apps).
# ⭐ Výjimka (2026-10-04): submodul, který je ZDROJEM npm workspaces — extranet
# SDK (packages/extranet-sdk → @aisha/extranet-sdk-ui/-tokens) — vstupem buildu
# JE: root testy a brány, workbench-shell i mobil z něj staví. Jeho posun proto
# app rozsvítit musí; mezi „cizí" submoduly nepatří.
SUBMODULY_ZDROJ_BUILDU="packages/extranet-sdk"
SUBMODULY=$(git config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{print $2}' \
  | grep -vxF "$SUBMODULY_ZDROJ_BUILDU" || true)
CHANGED_BEZ_SUBMODULU=$(grep -vxF -f <(printf '%s\n' $SUBMODULY) <<< "$CHANGED" || true)
echo "diag/submoduly: $(echo $SUBMODULY | tr '\n' ' ')" >&2

# Defaults: assume app changed (safe fallback for first commit / edge cases)
APP=true
EDGE_FUNCTIONS=false
N8N_NODES=false
EXTENSION=false
WORKBENCH=false
INFRA_WEB=false
INFRA_CORE=false
INFRA_KEYCLOAK=false
INFRA_INTEGRATION=false
INFRA_LANGFUSE=false
INFRA_ADMIN=false
INFRA_LLM_GATEWAY=false
INFRA_OPENCLAW=false
DOCS_ONLY=false
DB_CHANGE=false
N8N_WORKFLOW=false
SECURITY_CHANGE=false
MOBILE_APP=false
COSMOS=false
AV_CHANGE=false
SERVICES_CHANGE=false
BLOCKCHAIN_CHANGE=false
SURFACES=false
CI_CHANGE=false

if [ -n "$CHANGED" ]; then
  # --- App (web SPA) ---
  # `apps/` belongs here: the TypeScript job type-checks the surface shells, and a
  # list that cannot see them makes that gate blind exactly on the PRs it exists
  # to catch — a shell-only change would skip the job.
  #
  # `docker-compose*.yml` and `config/` belong here for the SAME reason
  # (2026-08-04): the gate job runs `npm run test:gates`, and a dozen of those
  # gates read nothing BUT compose files — coolify-compose-compliance,
  # network-alias-unique, depends-on-healthy, startup-order-two-lists-agree,
  # server-side-jwks-in-cluster. A PR touching only compose skipped every one
  # of them, so the gates that exist purely to guard compose were blind on
  # exactly the PRs they are for.
  #
  # ⛔ `packages/` je TŘETÍ výskyt téže třídy (naměřeno 2026-08-09): PR měnil
  # `packages/design-tokens/build.mjs` — generátor tokenů, ze kterého web bere
  # barvy — a `Web: Build`, `Web: Tests` i `Web: TypeScript & Lint` se PŘESKOČILY,
  # protože `packages/` v seznamu nebylo. V `packages/` přitom leží design-tokens,
  # design-language, extranet-sdk-ui, api-core, surface-blocks: knihovny, NA
  # KTERÝCH WEB STOJÍ. PR svítil zeleně s 8 běhy z 27 — zelená znamenala „neměřeno“.
  grep -qE '^(src/|apps/|packages/|package\.|package-lock|vite\.|vitest\.|tsconfig|index\.html|postcss\.|tailwind\.|eslint\.|components\.json|aisha/db/migrations/|aisha/db/sql/|scripts/|extensions/aisha-dirigent-claude/|docker-compose\..*\.ya?ml$|docker-compose\.ya?ml$|config/)' <<< "$CHANGED_BEZ_SUBMODULU" && APP=true || APP=false

  # --- Edge Functions ---
  grep -qE '^supabase/functions/' <<< "$CHANGED" && EDGE_FUNCTIONS=true || EDGE_FUNCTIONS=false

  # --- n8n Nodes ---
  grep -qE '^packages/n8n-nodes-aisha/' <<< "$CHANGED" && N8N_NODES=true || N8N_NODES=false

  # --- VS Code Extension ---
  # packages/workbench-core is a source dependency the extension bundles (the
  # workbench drainer imports @aisha/workbench-core), so a change to the shared
  # core must re-run the extension type-check/compile lane.
  grep -qE '^(extensions/aisha-dirigent/|packages/workbench-core/)' <<< "$CHANGED" && EXTENSION=true || EXTENSION=false

  # --- Workbench rail (extension drainer + shared core) ---
  # Gates the workbench-execution-rail-wired remediation gate so a drainer or
  # @aisha/workbench-core regression is caught even in an extension- or
  # core-only PR (the general test:gates lane only runs on app changes).
  grep -qE '^(extensions/aisha-dirigent/|packages/workbench-core/)' <<< "$CHANGED" && WORKBENCH=true || WORKBENCH=false

  # --- Infra: Web stack ---
  grep -qE '^(docker-compose\.coolify-prebuilt\.yml|Dockerfile\.web|Dockerfile\.migrate)$' <<< "$CHANGED" && INFRA_WEB=true || INFRA_WEB=false

  # --- Infra: Core stack (PostgREST + own gateway + edge functions runtime) ---
  # The legacy supabase-style API gateway Dockerfile reference was removed during
  # the rebrand (replaced by services/gateway/).
  grep -qE '^(docker-compose\.coolify\.yml|Dockerfile$|Dockerfile\.functions-init|Dockerfile\.db|coolify/)' <<< "$CHANGED" && INFRA_CORE=true || INFRA_CORE=false

  # --- Infra: Keycloak stack (OIDC Identity Provider) ---
  grep -qE '^(docker-compose\.coolify-keycloak\.yml|Dockerfile\.keycloak)$' <<< "$CHANGED" && INFRA_KEYCLOAK=true || INFRA_KEYCLOAK=false

  # --- Infra: Integration stack (ES, Ragnarok, RabbitMQ — Backend) ---
  grep -qE '^(docker-compose\.coolify-integration\.yml|Dockerfile\.ragnarok)$' <<< "$CHANGED" && INFRA_INTEGRATION=true || INFRA_INTEGRATION=false

  # --- Infra: Langfuse stack ---
  grep -qE '^docker-compose\.coolify-langfuse\.yml$' <<< "$CHANGED" && INFRA_LANGFUSE=true || INFRA_LANGFUSE=false

  # --- Infra: Admin stack ---
  grep -qE '^docker-compose\.coolify-admin\.yml$' <<< "$CHANGED" && INFRA_ADMIN=true || INFRA_ADMIN=false

  # --- Infra: LLM Gateway stack (Phase 2D autopilot — opt-in tier=optional) ---
  grep -qE '^docker-compose\.coolify-llm-gateway\.yml$' <<< "$CHANGED" && INFRA_LLM_GATEWAY=true || INFRA_LLM_GATEWAY=false

  # --- Infra: OpenClaw stack (Phase 2B autopilot — opt-in tier=optional) ---
  grep -qE '^docker-compose\.coolify-openclaw\.yml$' <<< "$CHANGED" && INFRA_OPENCLAW=true || INFRA_OPENCLAW=false

  # --- DB change (migrations + SQL SoT + the cold-start gate's OWN verify scripts /
  # pgTAP tests). The gate is scripts/db/verify-*.sh + aisha/db/tests/**; changing
  # the gate itself MUST re-run it, else a gate-vs-schema drift fix merges without
  # CI ever re-validating the gate.
  # src/tests/db/ patří do TÉHOŽ seznamu ze stejného důvodu jako aisha/db/tests/:
  # běhové sondy nad RPC bydlí tam (vitest sbírá jen src/**), ale bez téhle cesty
  # je jediná lane s živou DB přeskočí.
  # ⛔ `aisha/db/heals.sql` NAMĚŘENO 2026-09-11: chybělo tu, a přitom je to JEDINÁ
  # cesta, kterou se změna zdroje pravdy dostane do BĚŽÍCÍ databáze (874 direktiv
  # `\ir`). Soubor, který změnu DORUČUJE, musí být pro směrování stejně viditelný
  # jako soubor, který ji POPISUJE.
  # ⛔ `infra/postgres/` NAMĚŘENO 2026-09-18: OBSAH OBRAZU DB, který cold-start
  # staví a spouští (`set-passwords.sh`, init SQL) — PR #362 ho měnil a
  # `Cold-start: apply` i `Governance: DB & Security` se přeskočily.
  # ⛔ 2026-09-19 TŘETÍ výskyt téže vady → celé ADRESÁŘE místo souborů: seed
  # (`psql -f aisha/db/seed.compiled.sql` + jeho zdroje), `scripts/db/` (verify-*.sh
  # volají migrate.mjs, check-definer-rpc-security.mjs… tranzitivně) a verze obrazu
  # (`postgres-major.mjs` čte POSTGRES_MAJOR z image-versions.env). Předfiltr smí
  # být ŠIRŠÍ než to, co lane čte, nikdy užší — brána
  # obsah-obrazu-db-spousti-cold-start si univerzum bere z příkazů obou úloh.
  grep -qE '^(aisha/db/|src/tests/db/|scripts/db/|scripts/lib/postgres-major\.mjs$|config/image-versions\.env$|infra/postgres/)' <<< "$CHANGED" && DB_CHANGE=true || DB_CHANGE=false

  # --- n8n Workflow changes ---
  grep -qE '^n8n/workflows/' <<< "$CHANGED" && N8N_WORKFLOW=true || N8N_WORKFLOW=false

  # ⛔ ZMĚNA BRÁNY MUSÍ BRÁNU SPUSTIT. Do 2026-08-06 na `.github/workflows/`
  # nekoukal ŽÁDNÝ detektor, takže úprava lane nespustila tu samou lane — PR #140
  # měnil bránu nad overlayem a ta se na něm PŘESKOČILA (`success | Has been
  # skipped`). Tenhle skript je od 2026-09-25 součást téže brány: jeho změna musí
  # spustit totéž, co změna ci.yml.
  grep -qE '^(\.github/workflows/|scripts/ci/zmenene-cesty\.sh$)' <<< "$CHANGED" && CI_CHANGE=true || CI_CHANGE=false

  # --- Security-sensitive changes ---
  grep -qE '^(supabase/functions/|src/lib/security/|docker-compose\.coolify.*\.yml$|aisha/db/sql/functions/)' <<< "$CHANGED" && SECURITY_CHANGE=true || SECURITY_CHANGE=false

  # --- Mobile App ---
  # ⛔ `^mobile-app/` SAMO NESTAČÍ — archiv do TestFlightu nespadl na změně
  # v `mobile-app/`, ale na ROZLOŽITELNOSTI VAZBY mezi aplikací a sdíleným balíkem
  # (`@aisha/knock-protocol`). Seznam balíků NENÍ vymyšlený tady: bere se
  # z `extraNodeModules` v `mobile-app/metro.config.js`; že oba seznamy sedí,
  # hlídá brána mobil-bundle-univerzum. `.github/workflows/` z principu výš:
  # ZMĚNA BRÁNY MUSÍ BRÁNU SPUSTIT.
  grep -qE '^(mobile-app/|packages/(api-core|knock-protocol|extranet-sdk)/|packages/extranet-sdk$|\.github/workflows/)' <<< "$CHANGED" && MOBILE_APP=true || MOBILE_APP=false

  # --- Cosmos Go chain ---
  grep -qE '^cosmos/' <<< "$CHANGED" && COSMOS=true || COSMOS=false

  # --- AV upload flow (storage-auth scan/promote + clamav image + the runner) ---
  # Triggers the real clamd + MinIO integration gate (av-integration-gate).
  # docker/minio/ je tu proto, že test staví MinIO týmž Dockerfilem jako produkce:
  # změna obrazu tak na amd64 projde buildem i živým S3 dřív, než ji staví Coolify.
  grep -qE '^(services/storage-auth/|infra/clamav/|docker/minio/|scripts/test/run-av-integration\.mjs)' <<< "$CHANGED" && AV_CHANGE=true || AV_CHANGE=false

  # --- Services (any microservice src/test) + their shared runner ---
  # Gates the per-service vitest lane (npm run test:services). Runner-script
  # changes count too so the lane re-runs when how-we-test changes. plugins/ is in
  # here because that runner covers plugins as well: a plugin lives OUTSIDE the
  # npm workspace, so no workspace-shaped lane can see it (measured 2026-07-26:
  # plugins/eurowag-telematics shipped a suite that had never executed).
  # packages/ patří sem ze STEJNÉHO důvodu, jen o patro výš: služby z workspace
  # balíčků IMPORTUJÍ TYPY. ⛔ NAMĚŘENO 2026-09-05: #299 přidalo do `audience-types`
  # povinná pole; filtr úlohu PŘESKOČIL a `svc-source-broker` od té chvíle
  # nepřekládal — projevilo se až o pět merge později v cizím PR.
  grep -qE '^(services/|plugins/|packages/|scripts/test/run-service-tests\.mjs)' <<< "$CHANGED" && SERVICES_CHANGE=true || SERVICES_CHANGE=false

  # --- Blockchain service + its DB SoT (RPCs the integration test exercises) ---
  grep -qE '^(services/svc-blockchain/|aisha/db/migrations/|aisha/db/sql/|scripts/db/with-throwaway-(db|postgrest)\.mjs)' <<< "$CHANGED" && BLOCKCHAIN_CHANGE=true || BLOCKCHAIN_CHANGE=false

  # --- Surfaces (extranet SPA: shells + shared block contract + overlay) ---
  # This list is not a taste call — it is exactly what the extranet image BUILDS
  # from (deploy/surface-host/Dockerfile: npm ci → build -w packages/surface-blocks
  # → build -w apps/$SHELL_APP with AISHA_INSTANCE_DIR=instances/$AISHA_INSTANCE).
  # extranet SDK (submodul packages/extranet-sdk: gitlink i obsah) + design-language are here because the shell declares both as
  # `dependencies` and the Dockerfile bakes their SOURCE into the artifact.
  # Spelled as separate alternatives, not packages/(a|b|c)/: the ci-deploy-honesty
  # gate asserts this line CONTAINS each build input verbatim.
  grep -qE '^(apps/|packages/surface-blocks/|packages/extranet-sdk/|packages/extranet-sdk$|packages/design-language/|deploy/surface-host/|instances/|docker-compose\.coolify-extranet\.yml$|scripts/surfaces-build-all\.sh$|package-lock\.json$)' <<< "$CHANGED" && SURFACES=true || SURFACES=false

  # --- Docs only (skip everything) ---
  # `.github/` je dokumentace JEN mimo `workflows/` — od přesunu CI do
  # `.github/workflows/` je tamní změna změnou pipeline (ci_change), ne textu.
  NON_DOC=$(grep -vE '^(docs/|\.github/(PULL_REQUEST_TEMPLATE/|ISSUE_TEMPLATE/|agents/|copilot-instructions\.md$)|README\.md|CONTRIBUTING\.md|AGENTS\.md|CLAUDE\.md|RULES\.md|FEEDBACK\.md|FINAL-DRAFT\.md|aisha-story\.md|dirigent-plugin\.md|idea-full-implmentation-orchestrator\.md|security_and_test_analysis\.md|\.aisha/)' <<< "$CHANGED" || true)
  [ -z "$NON_DOC" ] && DOCS_ONLY=true || DOCS_ONLY=false
fi

# Conservative safety net: if changed files could NOT be determined (empty diff),
# do NOT skip the security-critical gates — run them. Better a redundant gate run
# than an unvalidated merge.
if [ -z "$CHANGED" ]; then
  DB_CHANGE=true
  SECURITY_CHANGE=true
  INFRA_CORE=true
  SERVICES_CHANGE=true
  BLOCKCHAIN_CHANGE=true
  SURFACES=true
fi

{
  echo "::group::Changed files ($(grep -c . <<< "$CHANGED" || true))"
  echo "$CHANGED"
  echo "::endgroup::"
  echo "Routing: app=$APP edge_functions=$EDGE_FUNCTIONS n8n_nodes=$N8N_NODES extension=$EXTENSION"
  echo "  infra: web=$INFRA_WEB core=$INFRA_CORE keycloak=$INFRA_KEYCLOAK integration=$INFRA_INTEGRATION langfuse=$INFRA_LANGFUSE admin=$INFRA_ADMIN"
  echo "  infra(opt-in): llm_gateway=$INFRA_LLM_GATEWAY openclaw=$INFRA_OPENCLAW"
  echo "  mobile_app=$MOBILE_APP cosmos=$COSMOS docs_only=$DOCS_ONLY"
  echo "  services_change=$SERVICES_CHANGE blockchain_change=$BLOCKCHAIN_CHANGE av_change=$AV_CHANGE"
  echo "  surfaces=$SURFACES ci_change=$CI_CHANGE"
} >&2

# ─── Fail-closed sebekontrola směrování ──────────────────────────────
# ⛔ NAMĚŘENO 2026-09-11, běh 3592 (PR #943, 390 souborů): krok vypsal
# `Changed files (390)` se 76 řádky `src/` a 66 řádky `mobile-app/` a O DVA ŘÁDKY
# NÍŽ `app=false mobile_app=false surfaces=false`. Verdikt tedy NEBYL funkcí
# seznamu, který sám vytiskl. Kombinovaný stav PR svítil `success` s 22 z 28 úloh
# `skipped`. Tahle kontrola NEOPRAVUJE příčinu — odmítá tichý přeskok. Měří TOUTÉŽ
# vstupní hodnotou, ale JINÝM nástrojem: shellovým `case`, ne `grep`. Vzory níž
# jsou úmyslně PODMNOŽINOU vzorů výše: co projde tudy, MUSÍ být rozsvícené i tam.
EXPECT_APP=false
EXPECT_MOBILE=false
EXPECT_SURFACES=false
EXPECT_DB=false
EXPECT_SERVICES=false
# `while read` + herestring (ne `for` s IFS, ne roura — přiřazení uvnitř cyklu musí přežít).
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if ! grep -qxF -e "$f" <<< "$SUBMODULY"; then   # submodul app nerozsvěcuje (viz výš)
    case "$f" in
      src/*|apps/*|packages/*|scripts/*|config/*) EXPECT_APP=true ;;
    esac
  fi
  case "$f" in
    mobile-app/*) EXPECT_MOBILE=true ;;
  esac
  case "$f" in
    apps/*|packages/surface-blocks/*|packages/extranet-sdk|packages/extranet-sdk/*|packages/design-language/*|deploy/surface-host/*|instances/*) EXPECT_SURFACES=true ;;
  esac
  case "$f" in
    aisha/db/*|src/tests/db/*|scripts/db/*|scripts/lib/postgres-major.mjs|config/image-versions.env|infra/postgres/*) EXPECT_DB=true ;;
  esac
  case "$f" in
    services/*|plugins/*) EXPECT_SERVICES=true ;;
  esac
done <<< "$CHANGED"

ROUTING_BUG=""
if [ "$EXPECT_APP" = true ] && [ "$APP" != true ]; then ROUTING_BUG="$ROUTING_BUG app"; fi
if [ "$EXPECT_MOBILE" = true ] && [ "$MOBILE_APP" != true ]; then ROUTING_BUG="$ROUTING_BUG mobile_app"; fi
if [ "$EXPECT_SURFACES" = true ] && [ "$SURFACES" != true ]; then ROUTING_BUG="$ROUTING_BUG surfaces"; fi
if [ "$EXPECT_DB" = true ] && [ "$DB_CHANGE" != true ]; then ROUTING_BUG="$ROUTING_BUG db_change"; fi
if [ "$EXPECT_SERVICES" = true ] && [ "$SERVICES_CHANGE" != true ]; then ROUTING_BUG="$ROUTING_BUG services_change"; fi

if [ -n "$ROUTING_BUG" ]; then
  {
    echo "::error title=směrování si protiřečí::Příznaky[$ROUTING_BUG] jsou false, ale seznam změn obsahuje cesty, které je MUSÍ rozsvítit. Úlohy by se tiše přeskočily — volající musí spustit CELOU sadu."
    echo "Cesty, které si to vynucují (prvních 20):"
    while IFS= read -r f; do
      case "$f" in
        src/*|apps/*|packages/*|scripts/*|config/*|mobile-app/*|aisha/db/*|infra/postgres/*|services/*|plugins/*|deploy/surface-host/*|instances/*) echo "  $f" ;;
      esac
    done <<< "$CHANGED" | head -20
  } >&2
  exit 1
fi

# Výstup = kontrakt pro $GITHUB_OUTPUT i pro hook. Klíče doslova jako dřív.
for var in app edge_functions n8n_nodes extension workbench infra_web infra_core infra_keycloak infra_integration infra_langfuse infra_admin infra_llm_gateway infra_openclaw docs_only db_change n8n_workflow security_change mobile_app cosmos av_change services_change blockchain_change surfaces ci_change; do
  eval "echo \"${var}=\${$(echo "$var" | tr '[:lower:]' '[:upper:]')}\""
done
