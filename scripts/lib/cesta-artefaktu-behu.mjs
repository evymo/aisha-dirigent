// =============================================================================
// cesta-artefaktu-behu.mjs — výpis selhání patří TOMU běhu, který selhal
// =============================================================================
// ⛔ SDÍLENÁ CESTA VYRÁBÍ CIZÍ NÁLEZ. `stack-smoke.mjs` ukládal celý výpis
// padlého kroku do `<tmp>/aisha-reports/stack-smoke-<krok>.log` — jméno odvozené
// JEN z kroku. Na stroji, kde běží deset sezení a střídají se ve frontě těžkých
// úloh, má ten soubor jednoho vítěze: kdo psal naposled. Obsluha pak otevře
// cestu, kterou jí běh vypsal, a čte PADLÝ KROK NĚKOHO JINÉHO.
//
// ⛔ NAMĚŘENO 2026-09-20: v adresáři byly čtyři soubory, jeden na krok, pro
// všechna sezení dohromady — a jedna relace z něj skutečně přečetla cizí nález
// jako svůj. Diagnostika, která ukazuje na cizí svět, je horší než žádná:
// žádná mlčí, tahle odpovídá sebejistě a špatně.
//
// Náprava je triviální a patří do jména: artefakt dostane podadresář podle
// BĚHU (pid + čas startu). Souběžné běhy si tím nemohou přepsat výpis ani
// omylem, a starší běhy zůstanou čitelné.
import { join } from 'node:path';

/**
 * Identita běhu. Počítá se JEDNOU při načtení modulu, ne při každém volání —
 * jinak by dva artefakty téhož běhu spadly do dvou adresářů.
 */
export const BEH_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;

/** Jméno kroku na bezpečný kousek cesty. */
export function nazevKroku(label) {
  return String(label).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'krok';
}

/**
 * Cesta k artefaktu JEDNOHO kroku JEDNOHO běhu.
 * @param {string} zaklad kořen pro artefakty (AISHA_REPORT_DIR nebo tmp)
 * @param {string} label  jméno kroku, tak jak ho vypsal běh
 * @param {string} [behId] identita běhu; výchozí je tenhle proces
 * @returns {{adresar: string, soubor: string}}
 */
export function cestaArtefaktuBehu(zaklad, label, behId = BEH_ID) {
  const adresar = join(zaklad, 'stack-smoke', behId);
  return { adresar, soubor: join(adresar, `${nazevKroku(label)}.log`) };
}
