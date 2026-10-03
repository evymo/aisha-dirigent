/**
 * Rozpozná BĚH, KTERÝ NIC NEZMĚŘIL — aby se nevydával za nález.
 *
 * ⛔ NAMĚŘENO 2026-09-03, třikrát za jeden den. Předpushová bariéra dala
 * červenou a nad NEZMĚNĚNÝM stromem pak zeleno. V uloženém výstupu toho běhu
 * stálo:
 *
 *     Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 *
 * `onTaskUpdate` je RPC, kterým worker hlásí hlavnímu procesu VÝSLEDKY testů.
 * Když vyprší, hlavní proces má neúplný stav — a z toho plyne přesně to, co
 * bylo vidět: fantomová selhání testů, které prošly (`packeta-api`,
 * `silent-degradation`); remediation hláška jmenující JINOU bránu, než která
 * spadla; nález ukazující na řádek, kde je v tom stromě komentář.
 *
 * ⭐ Takový běh NEZMĚŘIL NIC. Vykreslit ho jako tvrdou červenou je táž záměna,
 * kterou tenhle repozitář opakovaně opravuje: „nezměřeno" není „vada".
 * `dvernik-doctor` to rozlišuje (`∅ NEPROHLÉDNUTO`), bariéra to nedělala.
 * Komentář v `runStep` popisuje TÝŽ jev z 2026-08-09 („červená, u které nebyl
 * vypsán žádný assertion") — tehdy se opravila ČITELNOST, ne klasifikace.
 *
 * ⛔ ROZHODUJE PODPIS, NE NEÚSPĚCH. Kdyby se opakoval každý neúspěch, schovávaly
 * by se skutečné vady. Proto se podpis VYŽADUJE; bez něj je neúspěch nálezem.
 */

// ⛔ DEFINITIVNÍ VÝSLEDEK PŘEBÍJÍ PODPIS PORUCHY. NAMĚŘENO 2026-09-21 na dvou
// po sobě jdoucích pre-push bězích nad TÝMŽ stromem: lehká dráha vrátila kód 1
// a report jmenoval konkrétní padlé tvrzení (`passed 8030, failed 1`, oba běhy
// týž test) — a přesto se běh uzavřel jako NEZMĚŘENO, protože ve výstupu byl
// VEDLE TOHO podpis vypršelého RPC. Hláška pak řekla „nehledej vadu v kódu,
// zopakuj běh", zatímco vada v kódu tam byla. Stálo to dva běhy po ~7 minutách.
//
// To je přesně ta chyba, kterou hlavička výš označuje za opačnou: schovávání
// skutečných vad. Proto tu vedle podpisů PORUCHY stojí i podpisy DŮKAZU — a
// verdikt po opakovaném běhu se bere z důkazu, ne z podpisu.
//
// ⛔ A MĚŘÍ SE NAD ČISTÝM TEXTEM. V CI vitest barví i do roury, takže mezi
// slovy sedí escape sekvence; vzor `/Tests\s+\d+\s+failed/` by na barevném
// výstupu neuspěl a definitivní verdikt by zůstal nerozpoznán. (Táž vada, jaká
// v CI roky umrtvila toleranci RPC timeoutu v run-vitest.mjs.)
const KODY_BAREV = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*[A-Za-z]", "g");

/** Podpisy, které znamenají „měřidlo nedoběhlo", ne „kód je vadný". */
export const PODPISY_NEPLATNEHO_BEHU = Object.freeze([
  /\[vitest-worker\]:\s*Timeout calling/i,
  /Vitest caught \d+ unhandled error/i,
]);

/**
 * Podpisy DEFINITIVNÍHO výsledku: po běhu zbyl jmenovitý nález. Takový běh
 * něco změřil, i kdyby vedle toho vypršelo nějaké RPC.
 * `selhalo 0` se schválně nechytá — nula není nález.
 */
export const PODPISY_DEFINITIVNIHO_VERDIKTU = Object.freeze([
  /Tests\s+\d+\s+failed/i,
  /Test Files\s+\d+\s+failed/i,
  /verdikt:\s*SELHÁNÍ/i,
  /selhalo\s+[1-9]\d*/i,
]);

/** Text bez barev — rozhoduje se nad obsahem, ne nad tím, jak je vybarvený. */
export function bezBarev(text) {
  return typeof text === "string" ? text.replace(KODY_BAREV, "") : text;
}

/** @returns {boolean} true = po běhu zbyl jmenovitý nález */
export function maDefinitivniVerdikt(vystup) {
  if (typeof vystup !== "string" || vystup.length === 0) return false;
  const cisty = bezBarev(vystup);
  return PODPISY_DEFINITIVNIHO_VERDIKTU.some((re) => re.test(cisty));
}

/**
 * @param {string} vystup spojený stdout+stderr kroku
 * @returns {boolean} true = běh nic nezměřil (nejde o nález)
 */
export function behNicNezmeril(vystup) {
  if (typeof vystup !== "string" || vystup.length === 0) return false;
  // ⛔ TADY SE DŮKAZ SCHVÁLNĚ NEPŘEBÍJÍ. Tahle funkce odpovídá na otázku
  // „stojí za to běh ZOPAKOVAT?", ne „jak dopadl". Rozdíl je podstatný:
  // vypršené RPC umí vyrobit FANTOMOVÁ selhání testů, které prošly (to je
  // celý důvod z 2026-09-03), takže výstup s podpisem PORUCHY i s „Tests N
  // failed" může být jedno nebo druhé — a rozhodne až opakovaný běh.
  // Kdyby se tu důkaz přebil, přišli bychom o to opakování a fantom by se
  // hlásil jako nález. Co se z důkazu MÁ rozhodnout, je verdikt PO opakování;
  // k tomu slouží maDefinitivniVerdikt() — viz scripts/test/stack-smoke.mjs.
  return PODPISY_NEPLATNEHO_BEHU.some((re) => re.test(bezBarev(vystup)));
}
