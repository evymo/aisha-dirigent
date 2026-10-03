#!/bin/sh
# doruc-uzly-aisha.sh <zdroj-balicku> <koren-svazku-n8n>
#
# Zapíše sestavený balíček n8n-nodes-aisha do svazku n8n-data tam, odkud ho
# loader n8n načte s předponou balíčku: <koren>/nodes/node_modules/<jméno>.
# Proč tam a ne jinam: hlavička Dockerfile.n8n-nodes.
#
# Výměna je celá, nebo žádná: nová verze se složí vedle a přesune se na místo
# až po kontrole, že v ní je každý soubor, který manifest `n8n` slibuje.
# Rozbitá kopie tak nikdy nenahradí funkční a n8n nenastartuje nad polovičním
# balíčkem (depends_on: service_completed_successfully).
set -eu

zdroj="${1:?zdroj balíčku (adresář s package.json a dist)}"
koren="${2:?kořen svazku n8n-data}"
# Vlastník souborů n8n v obrazu n8nio/n8n (uživatel node).
vlastnik="1000:1000"

manifest="$zdroj/package.json"
[ -f "$manifest" ] || { echo "[n8n-uzly] FATAL: $manifest chybí — obraz nenese sestavený balíček." >&2; exit 1; }

jmeno="$(jq -r '.name // ""' "$manifest")"
verze="$(jq -r '.version // ""' "$manifest")"
case "$jmeno" in
  n8n-nodes-*) ;;
  *) echo "[n8n-uzly] FATAL: balíček '$jmeno' nemá tvar n8n-nodes-* — loader n8n by ho nenašel." >&2; exit 1 ;;
esac

moduly="$koren/nodes/node_modules"
cil="$moduly/$jmeno"
novy="$cil.novy"
stary="$cil.stary"

mkdir -p "$moduly"
rm -rf "$novy" "$stary"
cp -R "$zdroj" "$novy"

# Každá cesta z manifestu `n8n` (nodes i credentials) musí v nové kopii existovat;
# prázdný manifest je taky vada — loader by z balíčku nenačetl nic.
pocet=0
chybi=0
for soubor in $(jq -r '(.n8n.nodes // []) + (.n8n.credentials // []) | .[]' "$novy/package.json"); do
  pocet=$((pocet + 1))
  if [ ! -f "$novy/$soubor" ]; then
    echo "[n8n-uzly] chybí $soubor" >&2
    chybi=$((chybi + 1))
  fi
done
if [ "$pocet" -eq 0 ] || [ "$chybi" -ne 0 ]; then
  rm -rf "$novy"
  echo "[n8n-uzly] FATAL: manifest slibuje $pocet souborů, chybí $chybi — balíček se NEDORUČÍ, stávající zůstává." >&2
  exit 1
fi

if [ -e "$cil" ]; then mv "$cil" "$stary"; fi
mv "$novy" "$cil"
rm -rf "$stary"
# Init běží jako root (obraz alpine), n8n jako node — bez chown by n8n balíček
# nepřečetl. Mimo root (test na stroji vývojáře) vlastník už sedí.
if [ "$(id -u)" = "0" ]; then chown -R "$vlastnik" "$koren/nodes"; fi

echo "[n8n-uzly] $jmeno $verze doručen do $cil ($pocet souborů z manifestu)"
