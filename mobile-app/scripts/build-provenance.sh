#!/bin/bash
#
# build-provenance.sh — z JAKÉHO stromu se staví, pro OBĚ platformy
#
# ⛔ PROČ ZVLÁŠŤ (2026-09-04)
# Tenhle blok bydlel uvnitř `build-ios.sh`, takže Android NEMĚL ani kontrolu
# čistoty, ani razítko o původu — jeho APK a AAB nenesly záznam, z čeho vznikly.
# Našla to brána `platformy-si-jsou-rovny` hned při prvním spuštění
# (`AISHA_ALLOW_DIRTY_BUILD: umí iOS, Android NE`) jako PÁTÝ výskyt téže třídy
# za jediný den.
#
# ⭐ Důvod, proč razítko vzniklo, platí pro obě platformy stejně: 2026-09-01 byl
# pracovní strom mezi dvěma buildy přepnut na jinou větev, skript to mlčky
# přijal a vyrobil archivy BEZ opravy klepání. Poznalo se to z fotky obrazovky
# od majitele, ne z měřidla. Android má týž problém, jen se dosud tak často
# nestavěl.
#
# Vyžaduje: PROJECT_DIR, log_* funkce.
# Vyváží: GIT_VETEV · GIT_COMMIT · GIT_SPINAVY — hodnoty pro razítko artefaktu.


# ⛔ IDENTITU SI BEREME SAMI, NESPOLÉHÁME NA VOLAJÍCÍHO.
# Brána `mobil-identita-jeden-zdroj` to vyžaduje právem: skript, který na
# identitu SAHÁ, ale její zdroj neurčuje, jde zavolat s ručně nastaveným
# `VERSION_FILE` — a pravidlo „jeden zdroj identity" tím tiše padne.
# `app-profile.sh` je jen přiřazení proměnných s kontrolami, takže druhé
# načtení nic nerozbije; naopak zaručí, že hodnoty jsou odvozené, ne podstrčené.
. "$SCRIPT_DIR/app-profile.sh"
# ⛔ MĚŘÍ SE VSTUP, NE VLASTNÍ VÝSTUP — a proto to stojí ZDE, PŘED přeskinem.
#
# NAMĚŘENO 2026-09-03 na PRVNÍM skutečném buildu s overlayem: kontrola stála až
# před archivací, tedy AŽ ZA `npm run gen:tokens` (přepíše `src/theme/index.ts`)
# a za regenerací ikon. Build tím padal na SVÉM VLASTNÍM výstupu — s instančním
# overlayem nemohl podmínku splnit NIKDY a musel by se pouštět s
# `AISHA_ALLOW_DIRTY_BUILD=1`, což tu pojistku ruší. Kontrola, kterou jde splnit
# jen jejím vypnutím, nechrání nic.
#
# ⭐ Záměr zůstává beze změny: strom, ZE KTERÉHO se staví, musí jít zopakovat.
# Přeskinované soubory jsou ODVOZENÉ z overlaye, a ten je sám verzovaný — na
# zopakovatelnost archivu tedy nemají vliv. Měřit je znamená měřit sebe.

GIT_VETEV="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
GIT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null)"
if [ -z "$GIT_VETEV" ] || [ -z "$GIT_COMMIT" ]; then
    log_error "Nevím, z jaké větve a commitu se staví — $PROJECT_DIR není git strom."
    log_error "  Archiv bez tohohle údaje nejde po zamítnutí recenze zopakovat."
    exit 1
fi
# `wc -l` vrací 0 i pro prázdný vstup — na rozdíl od `grep -c`, které selže.
# ⛔ UNIVERZUM = CO BUILD PŘEPISUJE. Původně tu stálo jen `src` a `package.json`,
# jenže instanční build sahá i na `version.json` (identita z overlaye) a na
# `assets/` (ikony ze značky). Ty tedy zůstávaly NEMĚŘENÉ — a po buildu ležely
# ve stromě: `version.json` s instanční doménou shodil bránu `legacy-domains`
# a obrandované ikony čekaly, až je někdo omylem commitne (naměřeno 2026-09-03).
GIT_SPINAVY="$(git -C "$PROJECT_DIR" status --porcelain -- \
    "$PROJECT_DIR/src" "$PROJECT_DIR/package.json" \
    "$PROJECT_DIR/version.json" "$PROJECT_DIR/assets" 2>/dev/null | wc -l | tr -d ' ')"

if [ "$GIT_SPINAVY" != "0" ]; then
    log_error "Strom má $GIT_SPINAVY necommitnutých změn v mobile-app — build by nešel zopakovat."
    log_error "  Archiv, který nejde postavit znovu, se po zamítnutí recenze nedá opravit:"
    log_error "  nikdo neumí říct, co v něm bylo. Commitni, nebo vědomě povol:"
    log_error "    AISHA_ALLOW_DIRTY_BUILD=1 $0 …"
    # `+x` se ptá, jestli je proměnná DEKLAROVANÁ — nedosazuje za ni hodnotu.
    # `:-0` by byl fallback: vymyslel by odpověď na otázku „chce to člověk?".
    [ "${AISHA_ALLOW_DIRTY_BUILD+x}" = "x" ] && [ "$AISHA_ALLOW_DIRTY_BUILD" = "1" ] || exit 1
    log_warning "AISHA_ALLOW_DIRTY_BUILD=1 — stavím ze špinavého stromu na tvou odpovědnost."
fi
