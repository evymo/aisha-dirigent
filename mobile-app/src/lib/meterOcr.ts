/**
 * Vyčtení stavu měřidla z fotky displeje.
 *
 * ⭐ NÁVRH, NE ROZHODNUTÍ. Tenhle modul jen POMÁHÁ tomu, kdo stojí u měřidla:
 * nabídne číslo, které přečetl stroj, a člověk ho potvrdí nebo přepíše.
 * Autoritou je vždycky potvrzená hodnota — proto se tu nikdy nic neodesílá a
 * proto funkce raději vrátí `null` než hodnotu, kterou si není jistá. Špatně
 * předvyplněné pole je horší než prázdné: prázdné si člověk vyplní, špatné
 * potvrdí, protože „to tam appka napsala".
 *
 * OCR běží NA ZAŘÍZENÍ (ML Kit). To není detail: odečty se dělají u odlehlých
 * odběrných míst, kde signál nebývá, takže cloudová čtečka by tam byla k ničemu
 * — a fotka by musela ven, i když ji posílat nemusíme.
 */

/** Co stroj přečetl. `null` = nevím, a to je poctivá odpověď. */
export interface MeterReadingGuess {
  value: number;
  /** Text, ze kterého hodnota pochází — aby šlo dohledat, proč to tak přečetl. */
  raw: string;
}

/**
 * Kandidát na hodnotu vytažený z textu.
 *
 * Displeje elektroměrů mívají 5–8 číslic, často s jedním desetinným místem.
 * Vedle nich je ale na štítku výrobní číslo, číslo odběrného místa, rok výroby
 * a certifikační značky — všechno čísla. Proto se nebere „nějaké číslo", ale
 * nejlepší kandidát podle pravidel níž.
 */
interface Candidate {
  value: number;
  raw: string;
  digits: number;
  nearUnit: boolean;
}

/** Jednotky, které se u odečtu vyskytují. Blízkost k nim je silný signál. */
const UNIT = /\b(kwh|mwh|m3|m³|gj|kw)\b/i;

/**
 * Posbírá čísla z textu i s informací, jestli u nich stojí jednotka.
 *
 * Čárka i tečka jsou desetinný oddělovač (na displeji bývá čárka), tečka ale
 * může být i oddělovač tisíců — proto se skupiny tisíců rozpoznají zvlášť a
 * oddělovače se z hodnoty odstraní.
 */
function collect(fullText: string): Candidate[] {
  // ⚠️ PO ŘÁDCÍCH, a je to podstatné. Jednotka se hledá v okolí čísla — jenže
  // okno přes konec řádku si „přivlastní" jednotku od čísla na dalším řádku:
  // u „Nr. 70150911 / 012345,6 kWh" vyšlo výrobní číslo jako to u jednotky
  // a vyhrálo, protože je delší. Štítek je řádkovaný, tak se tak i čte.
  return fullText.split(/\r?\n/).flatMap(collectFromLine);
}

function collectFromLine(text: string): Candidate[] {
  const out: Candidate[] = [];
  // Číslo = číslice, uvnitř volitelně oddělovače tisíců/desetin.
  //
  // ⚠️ ŽÁDNÉ `\s` VE TŘÍDĚ. Zní to nevinně (na displeji bývají mezery), jenže
  // `\s` zahrnuje i konec řádku — a OCR vrací štítek po řádcích. Čísla pod
  // sebou se pak slepí do jednoho: „045821\n045821" dalo 45821045821 a
  // „Nr. 70150911\n012345,6 kWh" přečetlo výrobní číslo i stav jako jedno
  // číslo. Odhalily to testy níž, ne zařízení.
  const re = /\d[\d.,]*\d|\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, "");
    if (!digits) continue;

    // Poslední oddělovač s 1–3 číslicemi za ním je desetinná část; cokoli
    // dřívějšího jsou tisíce a mizí. `12.345,6` i `12,345.6` tak dají 12345.6.
    const lastSep = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
    let value: number;
    if (lastSep >= 0 && /^\d{1,3}$/.test(raw.slice(lastSep + 1).replace(/\s/g, ""))) {
      const whole = raw.slice(0, lastSep).replace(/\D/g, "");
      const frac = raw.slice(lastSep + 1).replace(/\D/g, "");
      value = Number(`${whole}.${frac}`);
    } else {
      value = Number(digits);
    }
    if (!Number.isFinite(value)) continue;

    // „U jednotky" = jednotka stojí do 12 znaků za číslem nebo těsně před ním.
    const after = text.slice(m.index + raw.length, m.index + raw.length + 12);
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    out.push({ value, raw, digits: digits.length, nearUnit: UNIT.test(after) || UNIT.test(before) });
  }
  return out;
}

/**
 * Vybere nejlepšího kandidáta, nebo nic.
 *
 * Pravidla, v tomhle pořadí:
 *   1. číslo u jednotky (kWh/m³…) vyhrává — je to nejsilnější signál displeje;
 *   2. jinak rozhoduje POČET ČÍSLIC: stav měřidla je delší než rok výroby
 *      i než jednociferné popisky;
 *   3. ⛔ REMÍZA ZNAMENÁ NIC. Dvě stejně dlouhá čísla (typicky stav a výrobní
 *      číslo na jednom štítku) nejdou rozlišit, a tipnout si znamená nabídnout
 *      člověku špatnou hodnotu s autoritou stroje. Vrací se `null`.
 *   4. Čísla kratší než 3 číslice se ignorují — to jsou popisky, ne stav.
 */
export function pickReading(text: string): MeterReadingGuess | null {
  const all = collect(text).filter((c) => c.digits >= 3);
  if (all.length === 0) return null;

  const withUnit = all.filter((c) => c.nearUnit);
  const pool = withUnit.length > 0 ? withUnit : all;

  const maxDigits = Math.max(...pool.map((c) => c.digits));
  const best = pool.filter((c) => c.digits === maxDigits);
  // Remíza mezi RŮZNÝMI hodnotami = nevíme. Táž hodnota vícekrát remíza není.
  const distinct = new Set(best.map((c) => c.value));
  if (distinct.size !== 1) return null;

  return { value: best[0].value, raw: best[0].raw };
}

/**
 * Přečte displej z fotky. `null` = nepřečteno (a appka nechá pole prázdné).
 *
 * Modul se načítá LÍNĚ a pád se polyká schválně: appka bez čtečky (nebo když
 * ML Kit na daném zařízení selže) musí dál umožnit odečet zadaný rukou.
 * OCR je pomůcka; kdyby jeho nedostupnost blokovala práci, byla by to
 * horší vada než chybějící pomůcka.
 */
export async function readMeterFromPhoto(uri: string): Promise<MeterReadingGuess | null> {
  try {
    const mod = await import("@react-native-ml-kit/text-recognition");
    const recognizer = mod.default ?? mod;
    const result = await recognizer.recognize(uri);
    const text: string = typeof result === "string" ? result : (result?.text ?? "");
    return text ? pickReading(text) : null;
  } catch {
    return null;
  }
}
