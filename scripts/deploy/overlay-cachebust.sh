#!/bin/sh
# =============================================================================
# overlay-cachebust.sh — hodnota, která se změní právě tehdy, když se změnil overlay
# =============================================================================
# Vypíše commit SHA vzdálené větve overlay repa. Ta hodnota se pak posílá jako
# build ARG (`*_CACHEBUST`) do Dockerfilu, který overlay klonuje.
#
# PROČ TO VŮBEC EXISTUJE
# BuildKit kešuje vrstvu podle TEXTU příkazu. Text `git clone` se mezi
# nasazeními nemění, takže klon proběhne jednou a pak už nikdy — v obrazu
# zůstane obsah overlay repa ze dne prvního buildu. Build přitom projde zeleně
# a kontejner nastartuje. Naměřeno 2026-08-02 na Dockerfile.keycloak.
#
# PROČ SHA A NE ČAS
# Časové razítko vynutí přestavbu VŽDY — správně, ale zbytečně: každý deploy
# platformy by znovu stahoval a přestavoval nezměněný overlay. SHA se změní
# právě tehdy, když se změnil obsah. Keš pak dělá to, co má.
#
# `git ls-remote` NEKLONUJE — je to jeden dotaz na refs, takže je levný i pro
# velká repa a nepotřebuje místo na disku.
#
# Použití:
#   CACHEBUST="$(scripts/deploy/overlay-cachebust.sh "$SURFACE_OVERLAY_GIT_URL" "$REF")"
#
# Argumenty:
#   $1  URL overlay repa (smí obsahovat token; ve výpisu se maskuje). Https URL
#       BEZ přihlašovacích údajů si token vezme z FORGEJO_TOKEN — stejně jako
#       build, který ho dostává secretem (Dockerfile.keycloak, …svc-source-broker).
#   $2  ref (větev/tag), volitelně — bez něj výchozí větev vzdáleného repa
#
# Návratové kódy:
#   0  na stdout je SHA
#   1  URL nezadaná, `git` chybí, nebo se ref nepodařilo přečíst
#
# Selhání je ZÁMĚRNĚ tvrdé: volající si nesmí dosadit prázdno a jet dál — to je
# přesně ta tichá cesta, kterou tenhle skript zavírá.
# =============================================================================
set -eu

URL="${1:-}"
REF="${2:-}"

if [ -z "$URL" ]; then
  echo "overlay-cachebust: chybí URL overlay repa" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "overlay-cachebust: git není k dispozici" >&2
  exit 1
fi

REDACTED=$(printf '%s' "$URL" | sed -E 's|(://)[^@/]+@|\1***@|')

# Odvozená URL overlaye je ZÁMĚRNĚ bez tokenu (jde do build ARGu). Soukromé repo
# se pak bez tokenu nepřečte a cachebust by vyšel prázdný — build na něm padá.
case "$URL" in
  *://*@*) : ;;
  https://*) [ -n "${FORGEJO_TOKEN:-}" ] && URL="https://${FORGEJO_TOKEN}@${URL#https://}" ;;
esac

# ⛔ `ls-remote` MIMO pracovní adresář. NAMĚŘENO 2026-09-25 (CI běh 1528, Deploy: Core):
# `actions/checkout` zapíše do LOKÁLNÍ konfigurace workspace
# `http.https://<forgejo>/.extraheader: AUTHORIZATION: basic <token běhu>` — token platí
# jen pro repo běhu. Git tu hlavičku pošle i na overlay repo a přebije token v URL:
# `could not read Password … terminal prompts disabled`, přestože token v URL platí
# (lokálně totéž prošlo). `-C` do neutrálního adresáře + bez GIT_DIR/GIT_WORK_TREE
# = žádná lokální konfigurace cizího repa.
# Neutrální adresář = čerstvý prázdný `mktemp -d`: v žádném repu není a nic se nehádá
# (dosazená výchozí cesta z TMPDIR by byl literál — brána zadny-fallback-nad-identitou).
NEUTRAL=$(mktemp -d)
ERRF=$(mktemp)
trap 'rm -f "$ERRF"; rmdir "$NEUTRAL" 2>/dev/null' EXIT
_ls_remote() {   # $1 = ref → SHA na stdout; stderr gitu se SBÍRÁ (dřív `2>/dev/null` schoval příčinu)
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$NEUTRAL" ls-remote --exit-code "$URL" "$1" 2>>"$ERRF" | cut -f1 | head -1
}

# Bez refu se ptáme na HEAD (výchozí větev vzdáleného repa), s refem na tu větev.
if [ -n "$REF" ]; then
  SHA=$(_ls_remote "refs/heads/${REF}") || SHA=""
  [ -n "$SHA" ] || SHA=$(_ls_remote "$REF") || SHA=""
else
  SHA=$(_ls_remote HEAD) || SHA=""
fi

if [ -z "$SHA" ]; then
  echo "overlay-cachebust: nepodařilo se přečíst ${REF:-HEAD} z ${REDACTED}" >&2
  # Důvod od gitu, s maskovaným tokenem (v URL i holý) — bez něj se hádá.
  if [ -s "$ERRF" ]; then
    sed -E 's|(://)[^@/]+@|\1***@|g' "$ERRF" \
      | if [ -n "${FORGEJO_TOKEN:-}" ]; then sed "s|${FORGEJO_TOKEN}|***|g"; else cat; fi \
      | sed -n '1,5s/^/  git: /p' >&2
  fi
  exit 1
fi

printf '%s\n' "$SHA"
