#!/usr/bin/env bash
# =============================================================================
# coolify-mutace.sh — shellový obal JEDINÉHO domova mutace aplikace v Coolify
# =============================================================================
# Použití (sourcovat, ne spouštět):
#   . "$(dirname "$0")/lib/coolify-mutace.sh"
#   odpoved="$(coolify_mutace deploy "$JMENO" "$UUID" --kdo muj-nastroj --prefix "$PREFIX" --force true)"
#   rc=$?
#   [ "$rc" -eq "$COOLIFY_MUTACE_DRZENO" ] && echo "$odpoved"   # „DRŽENO: … — …“, nic se neodeslalo
#   [ "$rc" -eq "$COOLIFY_MUTACE_EXTERNI" ] && echo "$odpoved"  # „EXTERNÍ: … — nevlastním“, nic se neodeslalo
#
# ⛔ ŽÁDNÁ LOGIKA TADY NENÍ — a být nesmí. Deploy, restart, start, stop, návrat
# i adresu webhooku skládá a odesílá `coolify-mutace.mjs`; tenhle soubor jen
# spustí jeho CLI. Dvě implementace téhož volání by se rozešly přesně tam, kde
# na tom záleží: jedna by se na držení zeptala, druhá ne.
#
# PROČ (změřeno čtením 2026-10-04): volání, které aplikaci v Coolify nasadí nebo
# restartuje, žilo ve více než dvaceti souborech vlastním `curl` a deklaraci
# držení (overlay instance, nasazeni-drzene.json) nečetlo žádné mimo vlny v CI.
# Pravidla: hlavička coolify-mutace.mjs.
#
#   coolify_mutace <akce> <jméno aplikace> <uuid> [přepínače CLI…]
#     akce      deploy | restart | start | stop | navrat | webhook
#     stdout    odpověď Coolify (JSON na jednom řádku); u webhooku adresa;
#               u držené aplikace hláška „DRŽENO: …“, u externí „EXTERNÍ: …“
#     návrat    0 = mutace přijata · 100 = DRŽENO · 101 = EXTERNÍ (nic se neodeslalo) ·
#               1 = Coolify nebo síť selhaly · 2 = chybné zadání nebo nečitelná
#               deklarace držení (nic se neodeslalo)
#     prostředí COOLIFY_URL (nebo COOLIFY_API) a COOLIFY_API_TOKEN — volající je
#               předá JEN tomuto volání (`VAR=… coolify_mutace …`), token nikdy
#               přepínačem
# =============================================================================

# Návratový kód „DRŽENO“ (totéž číslo jako KOD_DRZENO v nasazeni-drzene.mjs;
# shodu hlídá test domova mutace).
COOLIFY_MUTACE_DRZENO=100
# Návratový kód „EXTERNÍ“ — služba v tomhle prostředí není naše (profil: external_domain);
# totéž číslo jako KOD_EXTERNI ve vlastnictvi-aplikaci.mjs (shodu hlídá test domova mutace).
COOLIFY_MUTACE_EXTERNI=101

coolify_mutace() {
  local akce="${1:-}" jmeno="${2:-}" uuid="${3:-}"
  if [ "$#" -lt 3 ]; then
    echo "coolify_mutace: chce <akce> <jméno aplikace> <uuid> [přepínače] — nic jsem neodeslal." >&2
    return 2
  fi
  shift 3
  node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/coolify-mutace.mjs" \
    --akce "$akce" --jmeno "$jmeno" --uuid "$uuid" "$@"
}
