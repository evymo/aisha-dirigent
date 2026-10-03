// =============================================================================
// domeny-rozbal.mjs — rozbalení config/domains.env STEJNĚ jako
// `set -a; . config/domains.env` v aisha-cold-start.sh (~ř. 1005–1020).
// =============================================================================
//
// ⛔ NAMĚŘENO 2026-09-24 (<fork>, env-doktor puštěný SAMOSTATNĚ): do
// trezoru šly DOSLOVNÉ odkazy — `STORAGE_PUBLIC_URL=https://${API_DOMAIN_PUBLIC:-}/storage/v1`
// a `WEB_PUSH_VAPID_SUBJECT=https://${APP_DOMAIN:-}`. coolify-sync-envs `${…}`
// nerozbaluje (lib/env-soubor.sh), takže by do Coolify odešel doslovný řetězec.
//
// Příčina: domains.env nese SEBEODKAZY `X=${X:-}`. Starý rozbalovač hledal
// `process.env[n] ?? out[n]` a bez cold-startu vrátil out[X] — SYROVOU šablonu
// téhož klíče, kterou už znovu neprohledal. Proto to `:-` v hodnotě trezoru:
// v šabloně složeniny (`https://${API_DOMAIN_PUBLIC}/storage/v1`) není, přiteklo
// ze sebeodkazu. Pod cold-startem vada nekřičí — ten nejdřív sourcuje derivaci
// a pak domains.env, takže process.env nese rozbalené hodnoty.
//
// Tento modul proto dělá totéž, co shell:
//   · řádky POSTUPNĚ; odkaz vidí dřív přiřazené řádky souboru, jinak prostředí
//     (volající dodá hledání: prodEnv → process.env → derivace → cílový trezor);
//   · sebeodkaz `X=${X:-}` čte PROSTŘEDÍ, ne vlastní šablonu;
//   · vnořené výchozí `${A:-https://${B}}` se rozbalí celé (starý regex je
//     uřízl na prvním `}`).
// Cyklus z principu nevznikne — odkaz vidí jen řádky NAD sebou.
//
// Rozhoduje VÝSLOVNÁ deklarace, ne „hodnota chybí":
//   · `${X:-}` / `${X:-výchozí}` / `${X-…}` — volitelnost je deklarovaná, prázdno
//     JE hodnota. Složenina, které tím zbyde URL bez hostitele, je PRÁZDNO
//     (nikdy `https://`); v seznamu se vynechá jen ta položka.
//   · `${X}` / `${X:?…}` / `${X?…}` bez hodnoty — NEROZBALITELNÉ. Klíč se vrátí
//     v `nerozbalene` se jmény chybějících odkazů; hodnota se nevydá vůbec.
// =============================================================================

/** Strop vnoření výchozích hodnot — hlubší = vada souboru, ne hodnota. */
export const ODKAZ_MAX_HLOUBKA = 16;

// Operátory shellu, které domains.env používá nebo smí použít (nejdelší první).
const ZACATEK_ODKAZU = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:-|:\+|:\?|##|%%|-|\+|\?|#|%)?/;

/** Glob shellu (`*`, `?`) → regulární výraz; `nejkratsi` = líné `*`. */
function globNaRegex(vzor, nejkratsi) {
  let r = "";
  for (const z of vzor) {
    if (z === "*") r += nejkratsi ? ".*?" : ".*";
    else if (z === "?") r += ".";
    else r += z.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return r;
}

/** `${X#p}` `${X##p}` `${X%p}` `${X%%p}` — ořezání předpony/přípony jako v shellu. */
function orizni(hodnota, operator, vzor) {
  if (operator === "#" || operator === "##") {
    const m = new RegExp("^(" + globNaRegex(vzor, operator === "#") + ")", "s").exec(hodnota);
    return m ? hodnota.slice(m[1].length) : hodnota;
  }
  // Přípona: shell hledá nejkratší (%) / nejdelší (%%) shodu od KONCE.
  const zacatky = [...Array(hodnota.length + 1).keys()];
  const re = new RegExp("^" + globNaRegex(vzor, false) + "$", "s");
  const poradi = operator === "%" ? zacatky.reverse() : zacatky;
  for (const i of poradi) if (re.test(hodnota.slice(i))) return hodnota.slice(0, i);
  return hodnota;
}

/**
 * Rozbalí jednu hodnotu. `najdi(jmeno)` vrací `{ hodnota, volitelnePrazdne }`
 * nebo `null` (jméno nikde není).
 * @returns {{ hodnota: string, chybi: string[], volitelnePrazdne: boolean }}
 */
export function rozbalHodnotu(text, najdi, hloubka = 0) {
  let hodnota = "";
  const chybi = [];
  let volitelnePrazdne = false;
  let i = 0;
  while (i < text.length) {
    const z = text.indexOf("${", i);
    if (z < 0) { hodnota += text.slice(i); break; }
    hodnota += text.slice(i, z);
    const m = ZACATEK_ODKAZU.exec(text.slice(z));
    if (!m) { chybi.push(`neplatný odkaz „${text.slice(z, z + 24)}"`); break; }
    // Konec odkazu = párová `}` (výchozí hodnota smí obsahovat další `${…}`).
    let j = z + m[0].length;
    const teloOd = j;
    let otevreno = 1;
    while (j < text.length) {
      if (text.startsWith("${", j)) { otevreno++; j += 2; continue; }
      if (text[j] === "}" && --otevreno === 0) break;
      j++;
    }
    if (otevreno !== 0) { chybi.push(`${m[1]} (neuzavřená závorka)`); break; }
    const [, jmeno, operator = ""] = m;
    const vychozi = text.slice(teloOd, j);
    i = j + 1;

    const nalez = najdi(jmeno);
    const ma = Boolean(nalez && nalez.hodnota !== "");
    // `${X:+w}` — „je-li X, pak w": volitelnost je výslovná, prázdné X není chyba.
    if (operator === ":+" || operator === "+") {
      if (!ma) continue;
      const r = rozbalHodnotu(vychozi, najdi, hloubka + 1);
      hodnota += r.hodnota;
      chybi.push(...r.chybi);
      continue;
    }
    // Ořezání vzorem mění hodnotu, ale volitelnost NEdeklaruje.
    if (ma && ["#", "##", "%", "%%"].includes(operator)) {
      const vzor = rozbalHodnotu(vychozi, najdi, hloubka + 1);
      chybi.push(...vzor.chybi);
      hodnota += orizni(nalez.hodnota, operator, vzor.hodnota);
      continue;
    }
    if (ma) { hodnota += nalez.hodnota; continue; }
    if (operator === ":-" || operator === "-") {
      if (hloubka >= ODKAZ_MAX_HLOUBKA) { chybi.push(`${jmeno} (přetečení hloubky ${ODKAZ_MAX_HLOUBKA})`); continue; }
      const r = rozbalHodnotu(vychozi, najdi, hloubka + 1);
      hodnota += r.hodnota;
      chybi.push(...r.chybi);
      if (r.hodnota === "" || r.volitelnePrazdne) volitelnePrazdne = true;
      continue;
    }
    // `${X}` bez výchozí: prázdno je v pořádku JEN když X samo deklarovalo
    // volitelnost (`X=${X:-}` výš v souboru). Jinak je odkaz nerozbalitelný.
    if (nalez && nalez.volitelnePrazdne && ["", "#", "##", "%", "%%"].includes(operator)) {
      volitelnePrazdne = true;
      continue;
    }
    chybi.push(jmeno);
  }
  return { hodnota, chybi, volitelnePrazdne };
}

const URL_BEZ_HOSTU = /^[a-z][a-z0-9+.-]*:\/\/(\/|$)/i;

/** Vynechá položky tvaru `schéma://` bez hostitele; zbyde-li nic, je to prázdno. */
export function bezUrlBezHostu(hodnota) {
  return hodnota
    .split(",")
    .filter((polozka) => polozka !== "" && !URL_BEZ_HOSTU.test(polozka.trim()))
    .join(",");
}

/** Je hodnota URL (nebo seznam URL) s některou položkou bez hostitele? */
export function maUrlBezHostu(hodnota) {
  return hodnota.split(",").some((polozka) => URL_BEZ_HOSTU.test(polozka.trim()));
}

/**
 * JEDINÝ domov rozhodnutí „tohle do trezoru nezapsat" (stráž env-doktora, pro
 * každý druh klíče): doslovný odkaz `${…}` NEBO URL bez hostitele. Obojí je
 * složenina, které chyběl vstup — neprázdná, takže projde každou kontrolou na
 * prázdnotu, a coolify-sync-envs by ji rozeslal doslovně.
 */
export function nesmiDoTrezoru(hodnota) {
  const text = String(hodnota ?? "");
  return text.includes("${") || maUrlBezHostu(text);
}

/**
 * Rozbalí celý text domains.env.
 * @param {string} text        obsah config/domains.env
 * @param {(jmeno: string) => string} venku  hodnota z prostředí ("" = není)
 * @returns {{ hodnoty: Record<string,string>, sablony: Record<string,string>,
 *             nerozbalene: Map<string,string[]>, volitelnePrazdne: Set<string>,
 *             odkazyDopredu: string[] }}  `sablony` = syrový řádek (pro stráž volajícího)
 */
export function rozbalDomainsEnv(text, venku) {
  const hodnoty = {};
  const sablony = {};
  const nerozbalene = new Map();
  const volitelne = new Set();
  const definiceNa = new Map();
  const radky = text.split("\n");
  radky.forEach((radek, index) => {
    const m = radek.trim().match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m && !definiceNa.has(m[1])) definiceNa.set(m[1], index);
  });
  const odkazyDopredu = [];

  radky.forEach((surovy, index) => {
    const radek = surovy.trim();
    if (!radek || radek.startsWith("#")) return;
    const m = radek.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) return;
    const [, klic, sablona] = m;
    sablony[klic] = sablona;
    // Prosté `X=` je výslovná deklarace prázdna — stejná jako `X=${X:-}`.
    if (sablona === "") { hodnoty[klic] = ""; volitelne.add(klic); return; }

    const najdi = (jmeno) => {
      if (jmeno !== klic && Object.prototype.hasOwnProperty.call(hodnoty, jmeno)) {
        if (nerozbalene.has(jmeno)) return null;
        return { hodnota: hodnoty[jmeno], volitelnePrazdne: volitelne.has(jmeno) };
      }
      // Odkaz na řádek NÍŽ vidí v shellu prostředí, ne ten řádek — zaznamenat,
      // ať změnu pořadí v souboru nikdo neudělá potichu.
      if (jmeno !== klic && (definiceNa.get(jmeno) ?? -1) > index) odkazyDopredu.push(`${klic} → ${jmeno}`);
      const v = venku(jmeno);
      return v ? { hodnota: v, volitelnePrazdne: false } : null;
    };

    const r = rozbalHodnotu(sablona, najdi);
    if (r.chybi.length) {
      nerozbalene.set(klic, [...new Set(r.chybi)]);
      hodnoty[klic] = "";
      return;
    }
    const hodnota = r.volitelnePrazdne ? bezUrlBezHostu(r.hodnota) : r.hodnota;
    if (r.volitelnePrazdne && hodnota === "") volitelne.add(klic);
    hodnoty[klic] = hodnota;
  });

  return { hodnoty, sablony, nerozbalene, volitelnePrazdne: volitelne, odkazyDopredu };
}
