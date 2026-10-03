#!/bin/sh
# =============================================================================
# publish-plugins.sh — dopraví zabalené pluginy do katalogu. JEDNORÁZOVÝ krok.
# =============================================================================
# MÍSTO V DRÁZE
#   plugins/<slug>/manifest.json
#     → build.mjs    → dist/plugins/<slug>-<verze>.js (+ .sha256)
#     → TENHLE KROK  → MinIO + rpc/submit_plugin → plugin_catalog/plugin_versions
#     → svc-plugin-system si plugin stáhne podle `artifact_url`
#
# ⛔ PROČ VŮBEC EXISTUJE (naměřeno 2026-09-02)
# `plugin_catalog` měl NULA řádků, přestože v repu leží čtyři pluginy s platným
# manifestem. Ani `plugins:build`, ani `plugins:publish` NEMĚLY VOLAJÍCÍHO —
# `dist/plugins/` vůbec neexistovalo. Důsledek: `materialize_data_source` neměl
# co materializovat, `agent_knowledge_sources.source_plugin_id` bylo všude NULL,
# `plugin_schedules` prázdné a tabulky flotily (wd_*, tc_*) měly 0 řádků.
# Zdroj `webdispecink-fleet` byl přitom `is_active = true` — zapnutý zdroj bez
# vykonavatele. Nástroj `publish.mjs` vznikl 2026-08-12 PRÁVĚ kvůli téhle vadě
# a volajícího nikdy nedostal, takže se vada vrátila.
#
# ⭐ PROČ UVNITŘ STACKU, a ne z deploy hostitele
# `S3_ENDPOINT` i `AISHA_POSTGREST_URL` jsou VNITŘNÍ jména sousedů na sdílené
# síti instance (`<prefix>-minio:9000`, `<prefix>-postgrest:3000`). Ani jedno se
# zvenčí nepřeloží — publikace tedy MUSÍ běžet tam, kde ta jména něco znamenají.
#
# ⛔ OPRAVENO 2026-09-06: `AISHA_POSTGREST_URL` se sem brala z NASAZOVACÍHO
# prostředí, kde veze mesh adresu pro stanoviště zvenčí. Odsud se nepřeložila a
# publikace padala `fetch failed` při každém nasazení — katalog měl nula řádků.
# Compose ji teď odvozuje z prefixu instance, týmž idiomem jako `S3_ENDPOINT`.
#
# ⭐ PROČ SKUTEČNÝ UŽIVATEL, a ne service_role
# `submit_plugin` začíná `RAISE EXCEPTION 'Not authenticated'`: pod service_role
# je `auth.uid()` NULL. Není to obtíž, je to záměr — publikace pluginu je čin
# s autorem. Token se proto bere ROPC grantem na `aisha-bootstrap`, tedy TÝMŽ
# vzorem, jakým chodí `netbird-peer-discover` (servisní účet je pro IdP
# neviditelný a na prázdném datastoru by se navíc stal vlastníkem účtu).
#
# ⭐ SMÍ BĚŽET PŘI KAŽDÉM NASAZENÍ: `submit_plugin` je idempotentní
# (`ON CONFLICT (slug) DO UPDATE`, `ON CONFLICT (plugin_id, version) DO UPDATE`).
#
# ⛔ ŽÁDNÉ FALLBACKY. Chybí-li endpoint, pověření nebo bucket, skript SKONČÍ.
# Tiše publikovat jinam, než si kdo myslí, je horší než nepublikovat.
# =============================================================================
set -eu

musi() {
  eval "v=\${$1:-}"
  [ -n "$v" ] || { echo "[plugin-publish] ⛔ chybí $1 — $2" >&2; exit 1; }
}

# ⭐ STROJ NAVRHUJE, ČLOVĚK ZAPÍNÁ (rozhodnutí majitele 2026-09-04).
#
# Publikace běžela ROPC pod bootstrap uživatelem, protože `submit_plugin`
# vyžadoval `auth.uid()` — je to model PODÁNÍ: někdo nabízí, někdo schvaluje.
# U pluginů, které přicházejí S PLATFORMOU, ale žádný „někdo" není, a vynucený
# uživatel znamenal, že HESLO VLASTNÍKA ÚČTU muselo ležet v compose. Rohatka
# `build-time-mnozina` to právem odmítla (62 tajemství proti stropu 60).
#
# ⭐ Rohatka nebyla překážka, byl to SIGNÁL O ŠPATNÉM NÁVRHU: chyba nebyla
# v bráně, ale v tom, že se stroj vydával za člověka.
#
# Nově se publikuje SERVISNÍ ROLÍ. `submit_plugin` jí natvrdo přidělí
# `trust_tier='internal'`, bez autora a ve výchozím `status='submitted'` —
# takže stroj smí NAVRHNOUT, ne ZAPNOUT. Do provozu vede až
# `transition_plugin_status`, které vyžaduje `is_admin_or_staff()`.
#
# ⛔ ŽÁDNÉ NOVÉ TAJEMSTVÍ. `POSTGREST_SERVICE_TOKEN` core compose už veze
# (`generate-secrets.mjs`: emit('POSTGREST_SERVICE_TOKEN', SERVICE_ROLE_KEY)),
# takže heslo uživatele z nasazení MIZÍ a nic ho nenahrazuje.
musi POSTGREST_SERVICE_TOKEN "publikuje se servisní rolí; podání NENÍ aktivace"
musi AISHA_POSTGREST_URL   "kam zapsat katalog"
musi S3_ENDPOINT           "kam uložit artefakt"
musi S3_PLUGIN_BUCKET      "do kterého bucketu"

echo "[plugin-publish] balím pluginy…"
node scripts/plugins/build.mjs

# ⛔ TŘI STAVY, NE DVA. `|| true` nad výpisem adresáře slévalo „adresář
# neexistuje" (build selhal) s „adresář je prázdný" (fork bez pluginů) — a to
# první je porucha, druhé čekaný stav. Tiché spolknutí by z poruchy udělalo
# klidný konec, což je přesně ta třída, kterou brána `silent-degradation` hlídá.
if [ ! -d dist/plugins ]; then
  echo "[plugin-publish] ⛔ build neprodukoval dist/plugins — publikace se NEKONÁ" >&2
  exit 1
fi
POCET_ARTEFAKTU="$(find dist/plugins -name '*.js' -type f | wc -l | tr -d ' ')"
if [ "$POCET_ARTEFAKTU" = "0" ]; then
  echo "[plugin-publish] žádné zabalené pluginy — není co publikovat, končím ok"
  exit 0
fi
echo "[plugin-publish] artefaktů k publikaci: ${POCET_ARTEFAKTU}"

# ⛔ ŽÁDNÝ DOTAZ NA IdP. Servisní token je vydaný nasazením, ne vyměňovaný za
# heslo — odpadá tím celý ROPC hop i jeho selhání (naměřeno u jiných cest:
# `401 invalid_client` bez držené výpůjčky vypadá jako vada dodavatele).
echo "[plugin-publish] publikuji servisní rolí (podání, ne aktivace)…"
AISHA_ADMIN_JWT="${POSTGREST_SERVICE_TOKEN}"
export AISHA_ADMIN_JWT

echo "[plugin-publish] publikuji do ${S3_PLUGIN_BUCKET}…"
node scripts/plugins/publish.mjs
echo "[plugin-publish] hotovo"
