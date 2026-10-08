/**
 * PostgREST po změně schématu (typicky hned po migraci, NOTIFY pgrst) chvíli
 * znovu načítá schema cache a do té doby odpovídá 503 s kódem PGRST002
 * („Could not query the database for the schema cache. Retrying."). Je to stav
 * PŘECHODNÝ — init, který v tu chvíli zapisuje, nesmí selhat napořád.
 * Naměřeno 2026-10-08 v lokálním stacku: plugin-publish-init běžel souběžně
 * s načítáním cache a 2 ze 4 publikací padly; opakovaný běh prošel celý.
 *
 * Opakuje se JEN tenhle stav, nic jiného (401/403/4xx i jiná 503 se vrací hned).
 */

/** Je odpověď „schema cache se ještě načítá"? Čistá funkce. */
export function schemaCacheSeNacita(status, telo) {
  return status === 503 && /"code"\s*:\s*"PGRST002"/.test(String(telo ?? ""));
}

/**
 * Zavolá `posli()` (vrací fetch Response) a při PGRST002 to zkusí znovu,
 * nejvýš `pokusu`-krát s prodlevou `prodlevaMs`. Vrací poslední odpověď.
 */
export async function sOpakovanimPriNacitaniSchematu(
  posli,
  { pokusu = 6, prodlevaMs = 5_000, cekej = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  for (let pokus = 1; ; pokus += 1) {
    const odpoved = await posli();
    if (odpoved.ok || pokus >= pokusu) return odpoved;
    const telo = await odpoved.clone().text();
    if (!schemaCacheSeNacita(odpoved.status, telo)) return odpoved;
    await cekej(prodlevaMs);
  }
}
