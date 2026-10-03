#!/usr/bin/env bash
# ==============================================================================
# instance-identity.sh — kdo je tahle instance, zjištěné dřív, než se z toho počítá
# ==============================================================================
# Identita instance (APP_NAME_PREFIX / AISHA_STORY) je jediné, co na sdíleném
# Coolify odlišuje produkci jednoho zákazníka od druhého. Zaměřuje jméno každé
# aplikace, jmenný prostor NetBirdu, cestu k manifestu — a hlavně ROZSAH `--wipe`.
#
# ── PROČ TENHLE SOUBOR VZNIKL (naměřeno 2026-08-13) ──────────────────────────
# Řetěz deklarace měl tři implementace, každou s jiným seznamem kanálů:
#
#   aisha-cold-start.sh (prolog)       prostředí, .env.local
#   lib/coolify-instance-scope.mjs     prostředí, .env.coolify
#   generate-secrets.mjs firstNonEmpty .env-prod-backup, prostředí, .env.coolify
#
# Instance, která identitu deklaruje v .env.coolify + .env-prod-backup a nemá
# .env.local, tak pro bash prolog NEEXISTOVALA. STORY zůstalo prázdné, cesta
# k manifestu vyšla `…/.manifest` a `--wipe` skončil dřív, než cokoli udělal —
# zatímco generate-secrets by o pár kroků dál tutéž identitu přečetl bez potíží.
# Obejít to šlo jedině ručním exportem, tedy přesně tím krokem, který
# v autonomním cold-startu nesmí být.
#
# Řetěz proto bydlí na JEDNOM místě (lib/coolify-instance-scope.mjs) a shell si
# ho nepřepisuje — jen se ho ptá. Přidat kanál pak znamená přidat ho jednou,
# a ne ve třech jazycích s trojím pořadím.
# ==============================================================================

# declare_instance_identity
#   Naplní AISHA_STORY + APP_NAME_PREFIX z prvního kanálu, který je deklaruje,
#   a exportuje je. Nastaví INSTANCE_DECLARED=1, když identitu někdo DEKLAROVAL
#   (dosazení se za odpověď nepovažuje — to je pointa fail-closed kontroly).
#   Provenance se uloží do AISHA_IDENTITY_SOURCE: u wipe je „odkud to víme"
#   součástí odpovědi, ne jejím zdobením.
#
#   Volitelný $1 = kořen deklarace (adresář s .env.* soubory); prázdné = repo root.
#
#   Návratový kód:
#     0  identita je známá (nebo nedeklarovaná — to řeší fail-closed volajícího)
#     3  kanály si ODPORUJÍ → volající musí skončit, hláška je na stderr
#     4  chybí node → nejde to ZMĚŘIT; mlčet by znamenalo vydávat selhání nástroje
#        za nález „nedeklarováno" (a u wipe je ten rozdíl vším)
declare_instance_identity() {
  local root="${1:-}" line key value rc=0 out
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if ! command -v node >/dev/null 2>&1; then
    echo "instance-identity: node není v PATH — identitu instance nelze zjistit." >&2
    echo "  node je předpoklad celého cold-startu (topologie, secrets, Coolify API)." >&2
    return 4
  fi

  # Jen stdout se parsuje; stderr propadá rovnou operátorovi. Sloučit je do jednoho
  # proudu by znamenalo, že jakákoli poznámka nástroje vypadá jako deklarace klíče.
  out="$(AISHA_IDENTITY_ROOT="${root:-${AISHA_IDENTITY_ROOT:-}}" \
        node "${lib_dir}/coolify-instance-scope.mjs" --identity-shell)" || rc=$?
  if [ "$rc" != "0" ]; then
    return 3
  fi

  # Heredoc, ne roura: `while … | read` běží v subshellu a přiřazení by se ztratila.
  while IFS='=' read -r key value; do
    case "$key" in
      APP_NAME_PREFIX)       if [ -n "$value" ]; then APP_NAME_PREFIX="$value"; fi ;;
      AISHA_STORY)           if [ -n "$value" ]; then AISHA_STORY="$value"; fi ;;
      AISHA_IDENTITY_SOURCE) AISHA_IDENTITY_SOURCE="$value" ;;
    esac
  done <<EOF
$out
EOF

  if [ -n "${APP_NAME_PREFIX:-}${AISHA_STORY:-}" ]; then
    export APP_NAME_PREFIX="${APP_NAME_PREFIX:-}" AISHA_STORY="${AISHA_STORY:-}"
    export AISHA_IDENTITY_SOURCE="${AISHA_IDENTITY_SOURCE:-}"
    INSTANCE_DECLARED=1
  fi
  return 0
}
