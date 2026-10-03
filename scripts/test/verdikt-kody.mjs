// =============================================================================
// verdikt-kody.mjs — TŘI STAVY BĚHU, NE DVA
// =============================================================================
// ⛔ „NEVÍM" NENÍ „SELHALO". Běh testů dosud uměl jen zelenou a červenou, takže
// se do červené slévaly dvě nesouvisející věci: test, který poctivě spadl, a
// běh, po kterém nezbyl ŽÁDNÝ důkaz (zamrzl před souhrnem, report nevznikl).
// První se opravuje v kódu, druhý se opakuje — a dokud měly stejný návratový
// kód, nešlo je od sebe poznat ani v CI, ani v pre-push hooku.
//
// Kód 75 je `EX_TEMPFAIL` ze sysexits.h: „dočasné selhání, zkus znovu".
// Není zelený, takže se přes něj nedá protlačit push ani release; je ale
// ODLIŠITELNÝ, takže obsluha ví, že má běh zopakovat, ne hledat padlou bránu.
//
// Kdo tenhle kód vyrábí:  scripts/test/run-vitest.mjs (hlídač postupu)
// Kdo ho přebírá:         scripts/test/brany-obe-drahy.mjs (souhrn obou drah)
// =============================================================================

/** Změřeno a zelené. */
export const KOD_ZELENA = 0;
/** Změřeno a padlé — testy selhaly. */
export const KOD_SELHANI = 1;
/** NEZMĚŘENO — po běhu nezbyl důkaz, jak dopadl. Zopakovat, ne opravovat. */
export const KOD_NEZMERENO = 75;

// ── SOUHRN FÁZÍ ──────────────────────────────────────────────────────────────
// ⛔ NEZMĚŘENO SE ZTRÁCÍ NA ROUŘE. `stack-smoke.mjs` uměl poznat, že běh nic
// nenaměřil („ani opakovaný běh nic nezměřil"), ale ven poslal `{ ok: false }`
// — k nerozeznání od padlé brány. Fáze se pak uzavřela jako `✗ offline (FAIL)`
// a pre-push zamítl push hláškou „oprav před pushem". Naměřeno 2026-09-20
// dvakrát na téže větvi: nástroj správně poznal, že nic nenaměřil, a pak se
// zachoval, jako by naměřil vadu.
//
// Pravidla jsou tři a drží pohromadě:
//   1. nic nespadlo a vše se změřilo  → ZELENÁ,
//   2. cokoli poctivě spadlo          → SELHÁNÍ (nezměřené kroky na tom nic nemění),
//   3. selhaly JEN nezměřené kroky    → NEZMĚŘENO (push se pořád nepouští,
//      neověřeno není ověřeno — mění se diagnóza, ne přísnost).
/**
 * @param {{preflightOk: boolean, offlineOk: boolean,
 *          offlineNezmerene?: string[], offlineSelhaloZmerene?: boolean}} f
 * @returns {{kod: number, jenNezmereno: boolean}}
 */
export function verdiktFazi({
  preflightOk,
  offlineOk,
  offlineNezmerene = [],
  offlineSelhaloZmerene = false,
}) {
  if (preflightOk && offlineOk) return { kod: KOD_ZELENA, jenNezmereno: false };
  const jenNezmereno =
    preflightOk && !offlineOk && !offlineSelhaloZmerene && offlineNezmerene.length > 0;
  return { kod: jenNezmereno ? KOD_NEZMERENO : KOD_SELHANI, jenNezmereno };
}

/**
 * Popis stavu JEDNÉ dráhy do věty, která už slovo „selhání" obsahuje.
 * ⛔ NAMĚŘENO 2026-09-21: souhrn tiskl `verdikt: SELHÁNÍ (lehká SELHÁNÍ (kód 1),
 * těžká ZELENÁ)`. Zdvojené slovo není jen ošklivé — čte se, jako by se míchal
 * stav dráhy se stavem celku, a čtenář pak neví, které z těch dvou platí.
 */
export function popisDrahy(kod) {
  if (kod === KOD_ZELENA) return "zelená";
  if (kod === KOD_NEZMERENO) return `NEZMĚŘENO (kód ${KOD_NEZMERENO})`;
  return `padlé brány (kód ${kod})`;
}

/** Lidský popis návratového kódu pro souhrny. */
export function popisKodu(kod) {
  if (kod === KOD_ZELENA) return "ZELENÁ";
  if (kod === KOD_NEZMERENO) return "NEZMĚŘENO";
  return `SELHÁNÍ (kód ${kod})`;
}
