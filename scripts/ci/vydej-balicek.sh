#!/usr/bin/env bash
# vydej-balicek.sh — vydá balíček z AKTUÁLNÍHO adresáře do registru, pokud tam tahle
# verze ještě není. Chyba vydání je PÁD.
#
# ⛔ NAMĚŘENO 2026-10-04 (nedůvěřivé čtení, inventura vydavatelů): krok vydání balíčku
# n8n uzlů končil `npm publish … || echo "Version may already exist — skipping"`.
# Tím spolkl KAŽDOU chybu včetně E401: po vypršení tokenu se balíček tiše nevydal,
# úloha byla zelená a další krok restartoval službu „aby načetla novou verzi“.
# „Verze už existuje“ a „vydání selhalo“ jsou dvě různé věci; rozlišují se tady
# dotazem do registru PŘED vydáním, ne hádáním z chybového kódu.
#
# Přihlášení neřeší — to dělá `scripts/ci/registr-prihlaseni.sh nastav` + `over`
# v předchozích krocích (token v prostředí jako NODE_AUTH_TOKEN).
#
# Prostředí: VERDACCIO_URL (povinné), NODE_AUTH_TOKEN (pro vydání).
# Kódy: 0 vydáno nebo verze už v registru je · 1 vydání selhalo nebo stav registru
#   nejde zjistit (nevydává se naslepo).
set -euo pipefail

if [ -z "${VERDACCIO_URL:-}" ]; then
  echo "::error title=registr::VERDACCIO_URL není nastavená"
  exit 1
fi
[ -f package.json ] || { echo "::error title=registr::v $(pwd) není package.json — není co vydat"; exit 1; }

jmeno="$(node -p "require('./package.json').name")"
verze="$(node -p "require('./package.json').version")"

# Je tahle verze v registru? 404 = balíček ještě nikdy nevyšel. Cokoli jiného než
# jasná odpověď je NEZMĚŘENO — a naslepo se nevydává ani nepřeskakuje.
stav="$(JMENO="$jmeno" VERZE="$verze" node -e '
  const url = process.env.VERDACCIO_URL.replace(/\/+$/, "") + "/" + process.env.JMENO.replace("/", "%2f");
  const hlavicky = { Accept: "application/json" };
  if (process.env.NODE_AUTH_TOKEN) hlavicky.Authorization = "Bearer " + process.env.NODE_AUTH_TOKEN;
  fetch(url, { headers: hlavicky, signal: AbortSignal.timeout(30000) })
    .then(async (r) => {
      if (r.status === 404) return console.log("neni");
      if (!r.ok) return console.log("nezmereno HTTP " + r.status);
      const j = await r.json();
      console.log(j.versions && j.versions[process.env.VERZE] ? "je" : "neni");
    })
    .catch((e) => console.log("nezmereno " + String(e.message).split("\n")[0]));
')"

case "$stav" in
  je)
    echo "::notice title=registr::${jmeno}@${verze} už v registru je — nic k vydání"
    exit 0
    ;;
  neni) ;;
  *)
    echo "::error title=registr::nejde zjistit, jestli ${jmeno}@${verze} v registru je (${stav}) — nevydávám naslepo"
    exit 1
    ;;
esac

# Bez `|| …`: E401, E403 i výpadek sítě mají úlohu shodit.
npm publish --registry "$VERDACCIO_URL"
echo "Vydáno: ${jmeno}@${verze}"
