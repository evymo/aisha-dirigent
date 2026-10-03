/**
 * Jedno řazení textů pro všechno, co skripty zapisují nebo porovnávají.
 *
 * PROČ
 * `a.localeCompare(b)` BEZ locale řadí podle LANG stroje, na kterém běží.
 * Pod cs_CZ se „ch" řadí za „h" (samostatné písmeno), pod C/en-US ne — a CI
 * běží pod C. Změřeno 2026-09-24 na riq main 9cd998f0d: `npm run regen` pod
 * LC_ALL=C → 0 diff, pod LC_ALL=cs_CZ.UTF-8 → 7 artefaktů / 3 128 řádků
 * přeřazeno (baseline, seed.compiled, seed, 3× překlady, baseline-meta).
 * Každý, kdo regeneroval v češtině, dostal „drift", který nebyl ve zdroji.
 *
 * PROČ 'en'
 * Node pod LC_ALL=C bere výchozí locale en-US — tím vznikly všechny zapsané
 * artefakty. Pevné 'en' (bez oblastního rozšíření totéž řazení) je proto
 * zachová bajtově stejné a jen přestane záviset na stroji. Změna na řazení
 * podle kódových bodů by přeřadila všechny artefakty — to je jiné rozhodnutí.
 *
 * Brána `razeni-nezavisle-na-locale.gate.test.ts` nepustí do `scripts/`
 * `localeCompare(` bez zadané locale.
 */
const RAZENI = new Intl.Collator('en');

/** Porovná dva texty nezávisle na LANG stroje — pro `Array.prototype.sort`. */
export function porovnej(a, b) {
  return RAZENI.compare(a, b);
}
