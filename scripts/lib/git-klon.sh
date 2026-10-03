#!/usr/bin/env bash
# =============================================================================
# git-klon.sh — jedno místo, kde se v tomhle repu klonuje
# =============================================================================
# Použití (sourcovat, ne spouštět):
#   . "$(dirname "$0")/lib/git-klon.sh"
#   klonuj "$URL" "$CIL" [REF]   # vrací 0/1; při nezdaru VYSLOVÍ důvod
#
# ── PROČ TENHLE SOUBOR EXISTUJE ─────────────────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-08-20 na riqi, dvakrát v jednom dni:
#
#   1. Klon instance-data padal na `RPC failed; curl 18 Transferred a partial
#      file`. Volající měl `2>/dev/null`, takže z toho zbylo „clone failed" —
#      což vypadá jako špatné pověření. `git ls-remote` proti témuž URL přitom
#      vracel refy.
#   2. Nasazení core i edge aplikace selhalo na
#      `open Dockerfile.pki-init: no such file or directory`, přestože ten
#      soubor v nasazovaném commitu JE (4031 B) — buildkit dostal 2 bajty.
#      Neúplný kontext. Druhý pokus prošel BEZE ZMĚNY KÓDU.
#
# Obě vady mají týž tvar: velký přenos se nahodile utrhne, jeden pokus to
# nepřežije a diagnostika se cestou zahodí.
#
# ── CO S TÍM TENHLE POMOCNÍK DĚLÁ ───────────────────────────────────────────
#
#   1. OPAKUJE. Utržený přenos není chyba konfigurace, je to stav sítě.
#   2. Od druhého pokusu ČÁSTEČNÝM klonem (`--filter=blob:none`). Jeden velký
#      pack přes jedno spojení se trhá; bez historických blobů se rozloží na
#      víc menších požadavků a projde tam, kde celý ne. Historii nikdo z těchhle
#      volajících nepotřebuje — chtějí STROM.
#   3. NEZAHAZUJE stderr. Schová ho a při konečném nezdaru vysloví, s redakcí
#      pověření v URL.
#
# ⛔ NENÍ to fallback: cíl (mít strom) je pořád týž, mění se jen cesta k němu.
#    Když neprojde ani poslední pokus, vrací se NENULA — nikdy tichý úspěch.
# =============================================================================

klonuj() {
  _kl_url="$1"; _kl_cil="$2"; _kl_ref="${3:-}"
  [ -n "$_kl_url" ] && [ -n "$_kl_cil" ] || { echo "[git-klon] chybí URL nebo cíl" >&2; return 1; }
  _kl_redig=$(printf '%s' "$_kl_url" | sed -E 's|(://)[^@/]+@|\1***@|')
  _kl_err="$(mktemp)"
  _kl_ok=""
  for _kl_pokus in 1 2 3; do
    # Cíl se před opakováním musí vyprázdnit — git odmítne klonovat do neprázdného
    # adresáře. Pod suchým během se ale NEMAŽE nic: volající, který si jen ověřuje,
    # co by se stalo, nesmí přijít o data.
    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "[git-klon] [DRY RUN] rm -rf $_kl_cil" >&2
    else
      rm -rf "$_kl_cil"
    fi
    # 1. pokus mělký, další i bez historických blobů
    if [ "$_kl_pokus" -ge 2 ]; then _kl_filtr="--filter=blob:none"; else _kl_filtr=""; fi
    # shellcheck disable=SC2086 # prázdný přepínač se NESMÍ uvozovkovat
    if [ -n "$_kl_ref" ]; then
      git -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999 \
        clone --quiet --depth 1 $_kl_filtr --branch "$_kl_ref" "$_kl_url" "$_kl_cil" 2>"$_kl_err" && _kl_ok=1
    else
      git -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999 \
        clone --quiet --depth 1 $_kl_filtr "$_kl_url" "$_kl_cil" 2>"$_kl_err" && _kl_ok=1
    fi
    if [ -n "$_kl_ok" ]; then
      [ "$_kl_pokus" -gt 1 ] && echo "[git-klon] ${_kl_redig} naklonováno až na ${_kl_pokus}. pokus (částečný klon)" >&2
      rm -f "$_kl_err"; return 0
    fi
    echo "[git-klon] ⚠ ${_kl_redig} (${_kl_pokus}/3): $(sed -E 's|(://)[^@/]+@|\1***@|' "$_kl_err" | tr '\n' ' ' | tail -c 180)" >&2
  done
  _kl_duvod="$(sed -E 's|(://)[^@/]+@|\1***@|' "$_kl_err" | tr '\n' ' ')"
  rm -f "$_kl_err"
  echo "[git-klon] ⛔ ${_kl_redig}${_kl_ref:+ @ $_kl_ref} se nepodařilo naklonovat ani na 3. pokus: ${_kl_duvod}" >&2
  return 1
}
