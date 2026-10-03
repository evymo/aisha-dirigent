#!/usr/bin/env bash
# =============================================================================
# preflight-compose.sh — Validate compose env interpolation locally
# =============================================================================
# Runs `docker compose -f <compose> config -q` against every Coolify compose
# file with `.env.coolify` sourced as the env. Catches missing required env
# vars (`${X:?}` placeholders) before they break a Coolify deploy.
#
# Usage:
#   bash scripts/preflight-compose.sh                        # all compose files
#   bash scripts/preflight-compose.sh pki                    # only matching
#   COMPOSE_FILES="docker-compose.coolify-pki.yml" \
#     bash scripts/preflight-compose.sh
#
# Env file path: ENV_FILE=.env.coolify (overridable).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Výchozí env soubor podle prostředí z jednoho domova (PR2 izolace): ve stagingu
# `.env.<env>`, ne produkční `.env.coolify`. Cold-start předává ENV_FILE výslovně.
# shellcheck source=lib/prostredi-behu.sh
. "$ROOT/scripts/lib/prostredi-behu.sh"
ENV_FILE="${ENV_FILE:-$(pb_env_soubor "$ROOT" "${AISHA_ENV:-}")}"
FILTER="${1:-}"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'
info() { echo -e "${B}ℹ${N} $*"; }
ok()   { echo -e "${G}✅${N} $*"; }
warn() { echo -e "${Y}⚠️${N}  $*"; }
err()  { echo -e "${R}❌${N} $*" >&2; }

[ -f "$ENV_FILE" ] || { err "$ENV_FILE not found"; exit 1; }
command -v docker >/dev/null || { err "docker not installed"; exit 1; }

# Default file list: every docker-compose.coolify*.yml in repo root.
if [ -n "${COMPOSE_FILES:-}" ]; then
  # shellcheck disable=SC2206
  files=($COMPOSE_FILES)
else
  files=()
  while IFS= read -r line; do files+=("$line"); done < <(find "$ROOT" -maxdepth 1 -name 'docker-compose.coolify*.yml' -print | sort)
fi

# Overlay compose files (*.netseg.yml, *.overlay.yml) are additive fragments
# valid only when combined with the main compose via `-f` chaining. They
# intentionally omit `image:` / `build:` on services they extend, so
# standalone `docker compose config` always fails for them — skip here.
overlays=()
standalone=()
for f in "${files[@]}"; do
  case "$f" in
    *.netseg.yml|*.overlay.yml) overlays+=("$f") ;;
    *) standalone+=("$f") ;;
  esac
done
if [ ${#overlays[@]} -gt 0 ]; then
  echo -e "   ${Y}Skipping ${#overlays[@]} overlay file(s) (not standalone-valid):${N}"
  for f in "${overlays[@]}"; do echo "     - ${f#"$ROOT"/}"; done
fi
files=("${standalone[@]}")

# ── UNIVERZUM INTERPOLACE = CO INSTANCE SKUTEČNĚ NASAZUJE ────────────────────
#
# ⛔ NAMĚŘENO 2026-09-25 na forku. Preflight interpoloval KAŽDÝ
# docker-compose.coolify*.yml v repu, bez ohledu na to, jestli ho instance
# nasazuje. Instance s 15 aplikacemi tak padala na `TURN_PORT` livekitu a na
# operátorských tajemstvích cosmosu, llm-gateway a openclawu — tedy na
# deklaracích pro čtyři stacky, které NENÍ v jejím manifestu a nikdy se u ní
# nenasadí. Fail za cizí službu zastaví cold-start stejně spolehlivě jako fail
# za vlastní, jen se podle něj nedá nic opravit.
#
# Správná otázka není „interpoluje se tenhle soubor", ale „nasadí ho TAHLE
# instance". Odpověď má domov: manifest instance, podle kterého jede sync
# i redeploy (`manifest_declares_app` / `resolve_compose_for_app` v
# lib/coolify-app-vars.sh). Univerzum se z něj tedy ODVOZUJE, nehádá.
#
# Co manifest nenese, projde STRUKTURÁLNĚ (`--no-interpolate`): rozbité YAML se
# pozná dál, jen se nevyžadují tajemství pro schopnost, kterou profil nezapíná.
#
# Zvláštní případ source-brokeru tím MIZÍ — federace bez `SOURCE_API_URL` není
# v manifestu, takže spadne pod totéž pravidlo. Jeden případ místo výjimky.
#
# Bez manifestu (upstreamový checkout, CI bez instance) platí původní chování:
# interpoluje se všechno. Prázdné univerzum by byla brána, která nic neměří.
structural_only=()
_manifest_path="$(node "$ROOT/scripts/lib/coolify-instance-scope.mjs" --manifest-path 2>/dev/null || true)"
if [ -n "${_manifest_path:-}" ] && [ -f "$_manifest_path" ]; then
  _declared=()
  while IFS= read -r _line; do
    [[ "$_line" =~ ^app:[[:space:]]*[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+:([^[:space:]:]+) ]] || continue
    _declared+=("$(basename "${BASH_REMATCH[1]}")")
  done < "$_manifest_path"
  if [ ${#_declared[@]} -gt 0 ]; then
    keep=(); mimo=()
    for f in "${files[@]}"; do
      _base="$(basename "$f")"; _hit=0
      for _d in "${_declared[@]}"; do [ "$_d" = "$_base" ] && { _hit=1; break; }; done
      if [ "$_hit" = 1 ]; then keep+=("$f"); else mimo+=("$f"); structural_only+=("$f"); fi
    done
    if [ ${#mimo[@]} -gt 0 ]; then
      echo -e "   ${Y}Mimo manifest instance (${#mimo[@]}) — jen struktura, env se neinterpoluje:${N}"
      for f in "${mimo[@]}"; do echo "     - ${f#"$ROOT"/}"; done
    fi
    files=(${keep[@]+"${keep[@]}"})
    echo -e "   ${G}Univerzum z manifestu:${N} $(basename "$_manifest_path") → ${#files[@]} stack(ů) s envem"
  fi
fi

if [ -n "$FILTER" ]; then
  # ⛔ POROVNÁVÁ SE JMÉNO SOUBORU, NE CELÁ CESTA. Naměřeno 2026-09-05: `files`
  # drží absolutní cesty, takže `case "$f" in *"$FILTER"*` matchoval i adresář
  # repa — na forku, jehož adresář repa nese jméno instance
  # (`aisha-<fork>`), prošel filtr "<fork>" VŠECH 32
  # souborů místo jednoho, a `preflight-compose.sh <fork>` tak zeleněl pro
  # úplně jiný důvod, než operátor čekal. Filtr, který tiše nefiltruje, je táž
  # třída jako kontrola, která nemůže selhat.
  filtered=()
  for f in "${files[@]}"; do
    case "$(basename "$f")" in
      *"$FILTER"*) filtered+=("$f") ;;
    esac
  done
  # ⛔ Prázdné pole + `set -u` = „unbound variable" na bash 3.2 (výchozí na macOS).
  # Naměřeno 2026-09-04: `bash scripts/preflight-compose.sh pki` skončilo na
  # `filtered_structural[@]: unbound variable`, takže filtrovaný tvar — ten, který
  # hlavička sama dokumentuje — byl nepoužitelný. Idiom `${a[@]+"${a[@]}"}` expanzi
  # u prázdného pole vynechá místo aby spadl.
  files=(${filtered[@]+"${filtered[@]}"})
  filtered_structural=()
  for f in ${structural_only[@]+"${structural_only[@]}"}; do
    case "$(basename "$f")" in
      *"$FILTER"*) filtered_structural+=("$f") ;;
    esac
  done
  structural_only=(${filtered_structural[@]+"${filtered_structural[@]}"})
fi

[ $(( ${#files[@]} + ${#structural_only[@]} )) -gt 0 ] || { err "no compose files match"; exit 1; }

validation_count=$(( ${#files[@]} + ${#structural_only[@]} ))
info "preflight-compose: ${validation_count} file(s) (${#files[@]} with env, ${#structural_only[@]} structure-only)"

failed=()
# Optional stacks still receive schema validation when their operator contract
# is intentionally absent. `--no-interpolate` catches malformed YAML/Compose
# structure (for example an empty root `volumes:`) without requiring secrets
# for a capability that this profile does not deploy.
# `${arr[@]+"${arr[@]}"}`: bash 3.2 (macOS) pod `set -u` považuje PRÁZDNÉ pole
# za nenastavenou proměnnou a skript spadne na „unbound variable" — přesně když
# je zadaný COMPOSE_FILES a žádný soubor není structure-only. Naměřeno 2026-08-21.
for f in ${structural_only[@]+"${structural_only[@]}"}; do
  rel="${f#"$ROOT"/}"
  printf '   %-48s ' "$rel (structure only)"
  if out=$(docker compose -f "$f" config -q --no-interpolate 2>&1); then
    echo -e "${G}OK${N}"
  else
    echo -e "${R}FAIL${N}"
    echo "      $(echo "$out" | head -3)" | sed 's/^/      /'
    failed+=("$rel")
  fi
done
for f in "${files[@]}"; do
  rel="${f#"$ROOT"/}"
  printf '   %-48s ' "$rel"
  # Use docker compose --env-file to load values; suppress stdout, capture
  # stderr to surface the first missing variable.
  if out=$(docker compose --env-file "$ENV_FILE" -f "$f" config -q 2>&1); then
    echo -e "${G}OK${N}"
  else
    echo -e "${R}FAIL${N}"
    echo "      $(echo "$out" | head -3)" | sed 's/^/      /'
    failed+=("$rel")
  fi
done

echo
if [ ${#failed[@]} -eq 0 ]; then
  ok "All ${validation_count} compose files validated"
  exit 0
fi

err "Failed (${#failed[@]}/${#files[@]}): ${failed[*]}"
exit 1
