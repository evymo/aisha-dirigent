/**
 * adresa-v-rozsahu.mjs — leží adresa v některém z CIDR rozsahů?
 *
 * PROČ SAMOSTATNĚ. Rozhodnutí „tahle adresa je skok, ne klient" musí mít
 * JEDEN domov: používá ho nástroj, který navrhuje allowlist, i brána, která
 * ten nástroj měří. Druhá implementace by počítala jinak a brána by pak
 * potvrzovala něco jiného, než co nástroj dělá.
 *
 * Bez závislostí, IPv4 i IPv6. Neznámý tvar = false s důvodem, NIKDY tiché
 * true — u řízení přístupu je „nevím" blíž k „nepatří" než k „patří".
 */

/** Rozloží adresu na pole bajtů. IPv4 → 4 B, IPv6 → 16 B. null = nerozumím. */
export function bajty(adresa) {
  const a = String(adresa ?? '').trim().replace(/^\[|\]$/g, '');
  if (!a) return null;
  if (a.includes(':')) return bajtyIpv6(a);
  const casti = a.split('.');
  if (casti.length !== 4) return null;
  const out = [];
  for (const c of casti) {
    if (!/^\d{1,3}$/.test(c)) return null;
    const n = Number(c);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function bajtyIpv6(a) {
  // IPv4-mapped (::ffff:a.b.c.d) → ber jako IPv4, jinak by adresa z privátního
  // rozsahu proxy v mapované podobě prošla jako "jiná rodina" a rozsah by ji neodchytil.
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) return bajty(m[1]);
  const [hlava, ocas, ...zbytek] = a.split('::');
  if (zbytek.length) return null;
  const naSkupiny = (s) => (s ? s.split(':').filter((x) => x !== '') : []);
  const h = naSkupiny(hlava), o = ocas === undefined ? [] : naSkupiny(ocas);
  const chybi = 8 - (h.length + o.length);
  if (ocas === undefined ? h.length !== 8 : chybi < 0) return null;
  const skupiny = ocas === undefined ? h : [...h, ...Array(chybi).fill('0'), ...o];
  const out = [];
  for (const g of skupiny) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    out.push((n >> 8) & 0xff, n & 0xff);
  }
  return out.length === 16 ? out : null;
}

/** Leží `adresa` v CIDR `rozsah`? Neznámý tvar na kterékoli straně = false. */
export function vRozsahu(adresa, rozsah) {
  const r = String(rozsah ?? '').trim();
  if (!r) return false;
  const [siteStr, prefixStr] = r.split('/');
  const site = bajty(siteStr);
  const adr = bajty(adresa);
  if (!site || !adr || site.length !== adr.length) return false;
  const maxBitu = site.length * 8;
  const prefix = prefixStr === undefined ? maxBitu : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBitu) return false;
  let zbyva = prefix;
  for (let i = 0; i < site.length && zbyva > 0; i++) {
    const bitu = Math.min(8, zbyva);
    const maska = (0xff << (8 - bitu)) & 0xff;
    if ((site[i] & maska) !== (adr[i] & maska)) return false;
    zbyva -= bitu;
  }
  return true;
}

/** Který z rozsahů adresu obsahuje? null = žádný. */
export function kterýRozsah(adresa, rozsahy) {
  for (const r of rozsahy) if (vRozsahu(adresa, r)) return r;
  return null;
}
