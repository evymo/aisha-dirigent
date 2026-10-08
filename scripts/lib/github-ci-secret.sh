# shellcheck shell=bash
# =============================================================================
# github-ci-secret.sh — CI secret v repozitáři na GitHubu (Actions secrets)
# =============================================================================
# Sdílí ho deploy-init (COOLIFY_WEBHOOK_URL / COOLIFY_TOKEN), story-init
# (COOLIFY_UUID_*) a server-onboard (COOLIFY_SERVER_UUID_*). Jeden domov místo
# tří kopií téže logiky.
#
# GitHub přijme hodnotu secretu jen zašifrovanou veřejným klíčem repa (libsodium
# sealed box). To umí `gh secret set`; vlastní kryptografie v bashi by byla druhá
# implementace, která se rozejde. Hodnota jde do `gh` přes STDIN — nikdy přes
# argv (viditelné v `ps`) ani do logu.
#
# Vstupy (prostředí):
#   GITHUB_REPOSITORY  owner/repo — POVINNÉ, nedosazuje se (jinak by se secret
#                      zapsal do cizího repa)
#   GITHUB_TOKEN       token s právem zapisovat Actions secrets — POVINNÉ
#   GITHUB_API_URL     prázdné / https://api.github.com = github.com;
#                      jinak GitHub Enterprise (host se z URL odvodí pro GH_HOST)
#
# Návratové kódy github_ci_secret_set:
#   0  nastaveno
#   1  `gh` selhal (repo/token/práva) nebo je GITHUB_API_URL bez https
#   2  nenakonfigurováno (chybí GITHUB_REPOSITORY nebo GITHUB_TOKEN) — volající
#      krok přeskočí a ŘEKNE to, není to tichý úspěch
#   3  chybí `gh` CLI
# =============================================================================

# Je zápis CI secretů nakonfigurovaný (repo + token)?
github_ci_configured() {
  [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]
}

# Host GitHub Enterprise z GITHUB_API_URL; prázdný výstup = github.com.
# Návrat 1 = URL není https (token by šel nešifrovaně).
github_ci_enterprise_host() {
  local api="${GITHUB_API_URL:-}"
  api="${api%/}"
  case "$api" in
    ""|https://api.github.com) return 0 ;;
    https://*) api="${api#https://}"; printf '%s\n' "${api%%/*}" ;;
    *) return 1 ;;
  esac
}

# github_ci_secret_set NAME VALUE
github_ci_secret_set() {
  local name="$1" value="$2" host
  github_ci_configured || return 2
  command -v gh >/dev/null 2>&1 || return 3
  host="$(github_ci_enterprise_host)" || return 1
  if [ -n "$host" ]; then
    printf '%s' "$value" \
      | GH_HOST="$host" GH_ENTERPRISE_TOKEN="$GITHUB_TOKEN" \
        gh secret set "$name" --repo "${host}/${GITHUB_REPOSITORY}" >/dev/null 2>&1
  else
    printf '%s' "$value" \
      | GH_TOKEN="$GITHUB_TOKEN" gh secret set "$name" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1
  fi
}

# Lidsky čitelný důvod pro návratový kód github_ci_secret_set (bez hodnot).
github_ci_secret_reason() {
  case "$1" in
    0) echo "nastaveno" ;;
    2) echo "nenakonfigurováno (GITHUB_REPOSITORY / GITHUB_TOKEN)" ;;
    3) echo "chybí gh CLI (https://cli.github.com)" ;;
    *) echo "gh secret set selhal (repo, token nebo práva)" ;;
  esac
}
