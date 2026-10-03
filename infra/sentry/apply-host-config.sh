#!/usr/bin/env bash
# apply-host-config.sh — JEDINÝ DOMOV toho, jak je nastavený hostitel
# self-hosted Sentry. Spouští se NA TOM STROJI (`ssh sentry`), je idempotentní
# a dá se pustit znovu po každé přestavbě.
#
# ⛔ PROČ VZNIKL (naměřeno 2026-09-01/02 na produkci).
#
# Sentry běží mimo Coolify a instalovalo se ručně, takže jeho hostitel nikdy
# neměl v repu domov. Když 1. 9. došlo místo, projevilo se to řetězem, který
# vypadal jako pět různých poruch:
#
#     disk 100 %  →  Kafka spadla při zápisu checkpointu (ExitCode=1)
#                 →  vyčerpala 5 pokusů o restart a zůstala ležet
#                 →  12 konzumentů se marně připojovalo (load 155 na 6 jádrech)
#                 →  Sentry nezapsalo ani čas použití tokenu
#                 →  HTTP 500 na KAŽDÝ autentizovaný dotaz
#
# ⭐ ROZLIŠOVACÍ SONDA. Že jde o zápis (a tedy o disk), pozná se ZVENČÍ dřív,
# než se člověk na stroj přihlásí:
#
#     bez tokenu → 401 · VYMYŠLENÝ token → 500   ⇒ padá ověřování = padá ZÁPIS
#     bez tokenu → 401 · vymyšlený token → 401   ⇒ ověřování je v pořádku
#
# Nesmyslný token má dát 401. Že dá 500, znamená, že si ověření zapisuje čas
# posledního použití — a ten zápis neprojde.
#
# ⛔ CO TENHLE SKRIPT NEDĚLÁ: nezvětšuje partici. To je operace, u které se
# nesmí nic přerušit, a patří k ní člověk — postup je v README.md vedle.
set -euo pipefail

# ⛔ ŽÁDNÉ FALLBACKY. Hodnoty hostitele mají JEDEN domov — `host.env` vedle
# tohoto skriptu (verzovaný, není to tajemství). Výchozí hodnota v kódu by byla
# druhý domov téže otázky a tichá domněnka; když deklarace chybí, skript
# skončí dřív, než sáhne na fstab nebo journald.
DEKLARACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host.env"
[ -f "$DEKLARACE" ] || { echo "chybí deklarace hostitele: $DEKLARACE" >&2; exit 2; }
set -a; . "$DEKLARACE"; set +a
: "${SENTRY_DIR:?host.env musí deklarovat SENTRY_DIR}"
: "${RETENTION_DAYS:?host.env musí deklarovat RETENTION_DAYS}"
: "${JOURNAL_MAX:?host.env musí deklarovat JOURNAL_MAX}"
: "${JOURNAL_KEEP_FREE:?host.env musí deklarovat JOURNAL_KEEP_FREE}"
: "${SWAPFILE:?host.env musí deklarovat SWAPFILE}"
: "${SWAP_SIZE:?host.env musí deklarovat SWAP_SIZE}"

zmena=0
info() { printf '  %s\n' "$1"; }

# ── 1. Strop žurnálu ────────────────────────────────────────────────────────
# Bez něj vyrostl /var/log/journal na 2,6 GB na 28GB disku.
if grep -qE '^SystemMaxUse=' /etc/systemd/journald.conf; then
  info "žurnál: strop už nastavený"
else
  printf 'SystemMaxUse=%s\nSystemKeepFree=%s\n' "$JOURNAL_MAX" "$JOURNAL_KEEP_FREE" \
    >> /etc/systemd/journald.conf
  systemctl restart systemd-journald
  info "žurnál: nastaven strop $JOURNAL_MAX (rezerva $JOURNAL_KEEP_FREE)"
  zmena=1
fi

# ── 2. Swap ─────────────────────────────────────────────────────────────────
# Původní swap byl PARTICE ZA rootem; když se root rozšiřoval, musela zmizet.
# Swapfile na filesystému tu závislost ruší — root se pak dá zvětšit kdykoli.
if swapon --show 2>/dev/null | grep -q .; then
  info "swap: běží ($(swapon --show --noheadings --raw 2>/dev/null | head -1))"
else
  fallocate -l "$SWAP_SIZE" "$SWAPFILE"
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE" >/dev/null
  swapon "$SWAPFILE"
  grep -q "^${SWAPFILE} " /etc/fstab || echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
  info "swap: vytvořen $SWAPFILE ($SWAP_SIZE) a zapsán do fstab"
  zmena=1
fi

# ⛔ Sirotek ve fstabu ZDRŽÍ BOOT o 90 s: systemd čeká na zařízení, které už
# neexistuje. Naměřeno při rušení swap partice 2026-09-02.
if grep -qE '^UUID=[^ ]+ +none +swap' /etc/fstab; then
  info "⚠️ fstab má swap přes UUID — po zrušení partice by boot čekal; zkontroluj ho"
fi

# ── 3. Retence událostí ─────────────────────────────────────────────────────
# 90 dní se na tenhle stroj nevejde: samotné obrazy zaberou ~10 GB a data ~9 GB.
if [ -f "$SENTRY_DIR/.env" ]; then
  soucasna="$(grep -oP '(?<=^SENTRY_EVENT_RETENTION_DAYS=).*' "$SENTRY_DIR/.env" || true)"
  if [ "$soucasna" = "$RETENTION_DAYS" ]; then
    info "retence: už je $RETENTION_DAYS dní"
  else
    cp -a "$SENTRY_DIR/.env" "$SENTRY_DIR/.env.bak.$(date +%Y%m%d-%H%M%S)"
    sed -i "s/^SENTRY_EVENT_RETENTION_DAYS=.*/SENTRY_EVENT_RETENTION_DAYS=$RETENTION_DAYS/" "$SENTRY_DIR/.env"
    info "retence: $soucasna → $RETENTION_DAYS dní (záloha .env.bak.*)"
    # ⛔ Hodnotu čte PĚT kontejnerů; bez převytvoření zůstane stará.
    ( cd "$SENTRY_DIR" && docker compose up -d sentry-cleanup vroom-cleanup web taskworker snuba-api )
    # ⛔ A nginx si upstream vyřešil při SVÉM startu. Když se `web` převytvoří,
    # dostane novou IP a nginx drží starou → 502, ačkoli `web` je healthy.
    # Naměřeno 2026-09-02: pět minut výpadku právě tímhle.
    ( cd "$SENTRY_DIR" && docker compose restart nginx )
    info "retence: služby převytvořeny a nginx restartován (jinak 502 na starou IP)"
    zmena=1
  fi
fi

[ "$zmena" = "0" ] && info "nic k narovnání — hostitel odpovídá deklaraci"
exit 0
