# shellcheck shell=bash
# =============================================================================
# prostredi-behu.sh — JEDEN DOMOV odpovědi „na které prostředí tenhle běh míří"
# =============================================================================
# ⛔ NAMĚŘENO 2026-09-24 (fork, staging na sdíleném Coolify): stagingový cold-start
# běžel naostro proti PRODUKČNÍMU projektu (PR1 = izolace záměru a pinu projektu).
# Při jeho opravě se ukázalo, že otázku „je tohle produkce, jaký prefix, jaký env
# soubor" si každý skript odpovídá SÁM a každý jinak:
#   - obal: `<story>-staging` → COOLIFY_<STORY>_STAGING_*;
#   - discovery: začíná na „STAG"? jinak COOLIFY_PROD_* → `<story>-staging` četl
#     PRODUKČNÍ deklarace serverů a vydával COOLIFY_PROD_PROJECT_UUID;
#   - cold-start, env-doctor, preflight-compose, sync-envs, deploy-init, doktor:
#     `.env.coolify` napevno (slot `<story>-staging` neměl vlastní soubor; holý
#     staging ano, `.env.staging`) → stagingový běh přepsal produkční zdroj pravdy na
#     stanovišti obsluhy, převzal z něj tajemství (preserve_or_gen) a env-doctor
#     doplňoval ze `.env-prod-backup`.
# Odpověď proto žije TADY a v `prostredi-behu.mjs` (táž tabulka pro Node);
# brána `prostredi-behu-jeden-domov` hlídá, že se obě shodují a že je konzumenti
# používají.
#
# Tvar AISHA_ENV: production | prod | staging | stg | <story>-{staging,stg,prod,production}.
# Prázdné AISHA_ENV = přímý běh bez obalu = PRODUKCE (dosavadní chování, beze změny).

# pb_je_prod <env> — 0 = produkční běh, 1 = ne-produkční.
pb_je_prod() {
  case "${1:-}" in
    ""|production|prod|*-prod|*-production) return 0 ;;
    *) return 1 ;;
  esac
}

# pb_prefix <env> — prefix proměnných Coolify pro prostředí; neznámý tvar → rc 2.
pb_prefix() {
  case "${1:-}" in
    ""|production|prod) printf 'COOLIFY_PROD_' ;;
    staging|stg) printf 'COOLIFY_STAGING_' ;;
    *-staging|*-stg|*-prod|*-production) printf 'COOLIFY_%s_' "$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')" ;;
    *) return 2 ;;
  esac
}

# pb_env_soubor <repo> <env> — výchozí env soubor, který běh generuje a čte.
# Produkce: <repo>/.env.coolify (beze změny). Jinak: <repo>/.env.<env> — holý
# staging/stg → .env.staging, tedy táž hodnota, kterou už deklaruje
# config/coolify-environments.env (COOLIFY_STAGING_ENV_FILE) a čte _env-loader.sh.
# Výslovné COOLIFY_<ENV>_ENV_FILE má dál přednost (resolve_target_env v cold-startu).
pb_env_soubor() {
  local repo="$1" env="${2:-}"
  if pb_je_prod "$env"; then
    printf '%s/.env.coolify' "$repo"
    return 0
  fi
  pb_prefix "$env" >/dev/null || return 2
  case "$env" in
    staging|stg) printf '%s/.env.staging' "$repo" ;;
    *) printf '%s/.env.%s' "$repo" "$env" ;;
  esac
}

# pb_zdroj_doplneni <repo> <env> <zaloha> — soubor, ze kterého se smí doplňovat
# externí hodnoty (env-doctor heal). Produkce: <repo>/.env-prod-backup jako dosud
# (zadaná záloha se nebere — produkční běh se tímhle nemění). Ne-produkce: zadaná
# záloha je POVINNÁ a nesmí to být produkční záloha ani produkční env soubor →
# jinak rc 3 (nic se nevypíše).
pb_zdroj_doplneni() {
  local repo="$1" env="${2:-}" zaloha="${3:-}"
  if pb_je_prod "$env"; then
    printf '%s/.env-prod-backup' "$repo"
    return 0
  fi
  [ -n "$zaloha" ] || return 3
  case "$zaloha" in
    "$repo/.env-prod-backup"|"$repo/.env.coolify"|.env-prod-backup|.env.coolify|./.env-prod-backup|./.env.coolify) return 3 ;;
  esac
  printf '%s' "$zaloha"
}
