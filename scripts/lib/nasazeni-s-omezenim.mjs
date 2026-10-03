/**
 * Nasazení s omezenou souběžností — místo se uvolní až DOBĚHNUTÍM nasazení.
 *
 * ⛔ NAMĚŘENO 2026-09-24 (fork, sdílený hostitel). Fáze D cold-startu
 * přenasadila osm stacků NAJEDNOU: vlna spouštěla `Promise.all` přes všechny
 * cíle a každé nasazení si na uzlu stáhlo/postavilo své obrazy souběžně
 * s ostatními. Disk došel (ENOSPC, 100 %), kontejnery padly kaskádou
 * a opakovaný pokus narazil na pomocné kontejnery po přerušených nasazeních.
 *
 * „Sériově" tu proto NEZNAMENÁ „odeslat triggery postupně". Coolify trigger
 * jen zařadí nasazení a vrátí se; osm triggerů za sebou je z pohledu disku
 * totéž co osm najednou. Místo drží nasazení, dokud neskončí v koncovém stavu
 * (finished / failed / cancelled*), a teprve pak se spouští další.
 *
 * Univerzum: jeden běh aisha-redeploy (jedna instance). Nasazení cizích
 * nájemníků na sdíleném Coolify tenhle limit neřídí — to je věc Coolify.
 *
 * Modul je čistý: spouštění, čekání i brána se předávají zvenku, takže se dá
 * změřit bez živého Coolify (src/tests/gates/redeploy-seriove-a-diskova-brana).
 */

/** Koncové stavy nasazení v Coolify (prefix, bez ohledu na velikost písmen). */
const KONCOVY_STAV = /^(finished|failed|cancelled)/;

export function jeKoncovyStav(stav) {
  return KONCOVY_STAV.test(String(stav || "").trim().toLowerCase());
}

const spanekVychozi = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Počká, až nasazení doběhne do koncového stavu.
 *
 * Přechodná chyba čtení stavu NENÍ doběhnutí — čeká se dál až do stropu.
 * Strop vypršel = { dobehlo: false }: volající NESMÍ spustit další nasazení,
 * protože by tím porušil právě tu záruku, kvůli které se čeká.
 *
 * @param {string} deployment  uuid nasazení z triggeru
 * @param {{ ctiStav: (uuid: string) => Promise<string>, intervalMs?: number,
 *           limitMs: number, spanek?: (ms: number) => Promise<void>,
 *           ted?: () => number, priZmene?: (stav: string) => void }} o
 * @returns {Promise<{ dobehlo: true, stav: string } | { dobehlo: false, duvod: string }>}
 */
export async function pockejNaDobehnuti(deployment, o) {
  const { ctiStav, intervalMs = 10_000, limitMs, spanek = spanekVychozi, ted = Date.now, priZmene } = o;
  if (!Number.isFinite(limitMs) || limitMs <= 0) {
    throw new Error(`pockejNaDobehnuti: chybí strop čekání (limitMs=${String(limitMs)})`);
  }
  const start = ted();
  let posledni = "";
  let posledniChyba = "";
  for (;;) {
    try {
      const stav = String((await ctiStav(deployment)) || "").trim();
      posledniChyba = "";
      if (stav !== posledni) {
        posledni = stav;
        priZmene?.(stav);
      }
      if (jeKoncovyStav(stav)) return { dobehlo: true, stav };
    } catch (e) {
      posledniChyba = e?.message || String(e);
    }
    if (ted() - start >= limitMs) {
      const s = Math.round((ted() - start) / 1000);
      return {
        dobehlo: false,
        duvod: `nasazení ${deployment} nedoběhlo za ${s} s (poslední stav: ${posledni || "nepřečten"}` +
          `${posledniChyba ? `, chyba čtení: ${posledniChyba}` : ""})`,
      };
    }
    await spanek(intervalMs);
  }
}

/**
 * Spustí nasazení `jmena` tak, aby nejvýš `soubeznost` z nich bylo současně
 * „v letu" (od triggeru do koncového stavu).
 *
 * `predSpustenim(jmeno, { vLetu })` — brána před KAŽDÝM triggerem. `vLetu` jsou
 * jména, jejichž nasazení právě běží (pro souběžnost > 1 musí brána počítat
 * i s jejich spotřebou). Vrátí-li `{ ok: false }`, běh se ZASTAVÍ: tohle jméno
 * ani žádné další se nespustí.
 *
 * `spust(jmeno)` — trigger; vrací tvar triggerDeploy/triggerRestart
 * (`{ ok, deployment?, error?, backpressure? }`).
 *
 * `dobehni(jmeno, vysledek)` — čeká na koncový stav; `{ dobehlo: false }`
 * zastaví běh stejně jako brána (další trigger by porušil limit).
 *
 * Výsledky se vrací v pořadí vstupu. Nespuštěná jména nesou `zastaveno: true`.
 */
export async function spustSOmezenim(jmena, { soubeznost, predSpustenim, spust, dobehni }) {
  if (!Number.isInteger(soubeznost) || soubeznost < 1) {
    throw new Error(`spustSOmezenim: souběžnost musí být celé číslo ≥ 1 (dostal jsem ${String(soubeznost)})`);
  }
  const fronta = [...jmena];
  const vysledky = new Map();
  const vLetu = new Set();
  let zastaveni = null;

  const pracovnik = async () => {
    while (!zastaveni && fronta.length > 0) {
      const jmeno = fronta.shift();
      if (predSpustenim) {
        const brana = await predSpustenim(jmeno, { vLetu: [...vLetu] });
        if (!brana?.ok) {
          const duvod = brana?.duvod || "brána před spuštěním neprošla";
          zastaveni ??= { jmeno, duvod, druh: "brana" };
          vysledky.set(jmeno, { name: jmeno, ok: false, error: duvod, zastaveno: true, brana: true });
          return;
        }
        // Mezi bránou a triggerem mohl jiný pracovník zastavit běh.
        if (zastaveni) {
          fronta.unshift(jmeno);
          return;
        }
      }
      vLetu.add(jmeno);
      try {
        const r = await spust(jmeno);
        vysledky.set(jmeno, { name: jmeno, ...r });
        if (r?.ok && r.deployment) {
          const d = await dobehni(jmeno, r);
          if (d?.dobehlo) {
            vysledky.get(jmeno).dobehlo = d.stav;
          } else {
            zastaveni ??= { jmeno, duvod: d?.duvod || "nasazení nedoběhlo", druh: "nedobehlo" };
          }
        }
      } finally {
        vLetu.delete(jmeno);
      }
    }
  };

  const pocet = Math.min(soubeznost, Math.max(fronta.length, 1));
  await Promise.all(Array.from({ length: pocet }, pracovnik));

  const vystup = jmena.map((jmeno) => vysledky.get(jmeno) ?? {
    name: jmeno,
    ok: false,
    zastaveno: true,
    error: `nespuštěno — běh zastaven u ${zastaveni?.jmeno}: ${zastaveni?.duvod}`,
  });
  return { vysledky: vystup, zastaveni };
}
