/**
 * Je to kód jazyka (ISO 639-1, volitelně s regionem: `cs`, `pt-BR`)?
 *
 * `get_supported_languages` vrací i pseudo-locale `global` (obsah bez jazyka) —
 * do nabídky pro člověka nepatří. Nefiltruje se podle jména (magická konstanta),
 * ale podle tvaru kódu. Bez regexu s vnořeným kvantifikátorem
 * (security/detect-unsafe-regex).
 */
const DVE_PISMENA = /^[a-z]{2}$/i;

export function jeKodJazyka(kod: string): boolean {
  const casti = kod.split("-");
  return casti.length <= 2 && casti.every((c) => DVE_PISMENA.test(c));
}
