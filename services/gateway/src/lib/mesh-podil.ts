import type { TrustedEntry } from '@aisha/knock-protocol';

/**
 * Nese doručený seznam proxy vůbec nějakého mesh peera?
 *
 * ⛔ PROČ TO NENÍ „je seznam neprázdný"
 * Prázdný seznam už hlídá jiná stráž. Tahle míří na tišší stav: seznam DORAZÍ,
 * ale nese jen ROZSAHY. Chůze zprava (`clientIpFrom`) se pak zastaví na mesh
 * skoku, dveře uvidí u KAŽDÉHO požadavku adresu našeho vlastního prvku a
 * v `enforce` zavřou přede všemi. Navenek to vypadá jako „nikdo správně neťuká",
 * takže se to hledá v appkách místo v konfiguraci (naměřeno 2026-08-31).
 *
 * ⛔ LOOPBACK SE NEPOČÍTÁ, A PRÁVĚ NA TOM PRVNÍ VERZE TÉHLE STRÁŽE ZEMŘELA.
 * Napsal jsem ji jako „aspoň jedna položka bez lomítka" — jenže `127.0.0.1` je
 * v základním seznamu VŽDYCKY a lomítko nemá. Podmínka tedy platila za všech
 * okolností a stráž nemohla NIKDY spustit. Kontrola, která nemůže selhat, je
 * horší než žádná: tváří se jako záplata, takže ji nikdo znovu nepřezkoumá.
 *
 * ⭐ PROČ BEZ PODMÍNKY NA MESH
 * Mesh je jediná cesta dovnitř a je vždy nutný — instance bez něj neexistuje.
 * Stráž se proto neptá, jestli mesh běží; ptá se jen, jestli jsou dveře zapnuté.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Adresa peera = položka bez prefixu, která není loopback. */
export function jePeerAdresa(polozka: string): boolean {
  const v = polozka.trim();
  return v.length > 0 && !v.includes('/') && !LOOPBACK.has(v);
}

/**
 * Obsahuje seznam aspoň jednoho peera?
 *
 * ⛔ MĚŘÍ SE ROZPARSOVANÁ PODOBA, NE SYROVÝ ŘETĚZEC — a je to rozdíl.
 * `parseTrusted` vadné položky TIŠE ZAHAZUJE (`continue`). Kdyby se stráž
 * ptala syrového seznamu, položka, která VYPADÁ jako adresa peera, ale
 * parserem neprojde, by se počítala — a v seznamu, podle kterého se
 * u dveří opravdu rozhoduje, by neexistovala. Stráž by mlčela právě tehdy,
 * kdy má křičet. Ptáme se proto toho tvaru, který nese rozhodnutí.
 *
 * `kind: 'exact'` je přesně „adresa bez prefixu"; `cidr` je rozsah.
 */
export function maMeshPodil(seznam: readonly TrustedEntry[]): boolean {
  return seznam.some((e) => e.kind === 'exact' && !LOOPBACK.has(e.value.trim()));
}
