/**
 * Které ARGy Dockerfilu jsou VSTUPEM, bez kterého funkce nejde — a musí je proto
 * compose předat v `build.args`.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (log Coolify nasazení extranetu):
 * `deploy/surface-host/Dockerfile` se větví na `SURFACE_OVERLAY_GIT_URL`
 * (a pod ním na `_PATH` / `_CACHEBUST` do `exit 1`), compose extranetu je
 * nepředával a build šel `if [ -n "" ]` → z referenčního adresáře → ENOENT.
 * Brána `overlay-arg-dotece-do-buildu` to NEVIDĚLA: po prvním běhu se zúžila
 * na ARGy, u kterých Dockerfile hlásí „skipped" — a povrch žádné „skipped"
 * nepíše, prázdná větev prostě mlčky nic neudělá.
 *
 * PROČ SE TEHDY ZUŽOVALO — A PROČ TO ROZLIŠENÍ NESTAČILO
 * První verze brány brala každý ARG „poblíž `exit 1`" a chytila `SKIP_I18N_CHECK`
 * (Dockerfile.web): opt-out se správným výchozím chováním. Zúžení na „skipped"
 * ho vyřadilo, ale měřilo PRAVOPIS hlášky, ne vlastnost. Vlastnost, která
 * `SKIP_I18N_CHECK` od overlaye odlišuje, je strukturní — a jsou dvě:
 *
 *   1. VÝCHOZÍ HODNOTA. `ARG SKIP_I18N_CHECK=false` nese smysluplný default:
 *      nepředaný arg = zamýšlené chování. Overlay ARGy mají default PRÁZDNÝ
 *      (`ARG SURFACE_OVERLAY_GIT_URL=`) — nepředaný arg = „funkce vypnutá",
 *      k nerozeznání od „chtěl jsem ji a nedotekla".
 *   2. TEST PRÁZDNOTY, NE HODNOTY. Opt-out se porovnává (`!= "true"`); vstup
 *      funkce se testuje na prázdnotu (`[ -n "$X" ]` / `[ -z "$X" ]`).
 *
 * Hlášená je tedy průnik: ARG s PRÁZDNÝM defaultem, jehož prázdnotu testuje RUN,
 * který se podle ní VĚTVÍ do důsledku — `exit N` (build padne) nebo hláška
 * o přeskočení (funkce se tiše vypne). Obojí znamená, že bez předání nefunguje.
 *
 * Proč i `exit 1` a ne jen tiché vypnutí: `_CACHEBUST`/`_PATH` padají nahlas,
 * ale jen UVNITŘ zapnuté funkce — nepředané rozbijí přesně ten build, kvůli
 * kterému se funkce zapnula, a to až na build serveru. Předat je stojí řádek.
 */

/**
 * Instrukce Dockerfilu se spojenými pokračovacími řádky. Komentářové řádky
 * uvnitř pokračování parser Dockeru zahazuje — tady taky, jinak by instrukce
 * skončila uprostřed příkazu.
 * @returns {string[]}
 */
export function instrukce(text) {
  const out = [];
  let cur = null;
  for (const radek of text.split("\n")) {
    if (cur !== null) {
      if (/^\s*#/.test(radek)) continue;
      cur.push(radek);
      if (!radek.trimEnd().endsWith("\\")) {
        out.push(cur.join("\n"));
        cur = null;
      }
      continue;
    }
    if (/^\s*(#|$)/.test(radek)) continue;
    if (radek.trimEnd().endsWith("\\")) cur = [radek];
    else out.push(radek);
  }
  if (cur !== null) out.push(cur.join("\n"));
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} text obsah Dockerfilu
 * @returns {{ arg: string, proc: "exit" | "přeskočí" }[]}
 */
export function branaciArgy(text) {
  const nalezy = new Map();
  let vRozsahu = new Set(); // ARGy s prázdným defaultem deklarované v aktuální stage
  for (const ins of instrukce(text)) {
    if (/^\s*FROM\s/i.test(ins)) {
      vRozsahu = new Set();
      continue;
    }
    const arg = ins.match(/^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)\s*(=\s*)?$/);
    if (arg) {
      vRozsahu.add(arg[1]);
      continue;
    }
    // ARG s NEPRÁZDNÝM defaultem ruší dřívější prázdnou deklaraci téhož jména.
    const sDefaultem = ins.match(/^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\S/);
    if (sDefaultem) {
      vRozsahu.delete(sDefaultem[1]);
      continue;
    }
    if (!/^\s*RUN\s/i.test(ins)) continue;
    const dusledek = /\bexit\s+[1-9]/.test(ins) ? "exit" : /skipped|skipping|přeskočen/i.test(ins) ? "přeskočí" : null;
    if (!dusledek) continue;
    for (const a of vRozsahu) {
      const e = escape(a);
      const testPrazdnoty = new RegExp(`(?:\\[|\\btest)\\s+-[nz]\\s+"?\\$(?:\\{${e}\\}|${e}\\b)`);
      if (testPrazdnoty.test(ins) && !nalezy.has(a)) nalezy.set(a, dusledek);
    }
  }
  return [...nalezy].map(([arg, proc]) => ({ arg, proc }));
}
