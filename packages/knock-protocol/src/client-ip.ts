/**
 * Kdo je klient — jediná odpověď pro celou bránu.
 *
 * ⛔ PROČ NE „první zleva"
 * Do 2026-08-06 se klient bral jako `x-forwarded-for.split(',')[0]`. Každá proxy
 * v cestě k hlavičce jen PŘIPISUJE, takže když si návštěvník pošle vlastní
 * `X-Forwarded-For: 1.2.3.4`, vznikne řetěz
 *
 *     1.2.3.4, <skutečný klient>, <naše proxy>
 *      ▲ vymyšlené
 *
 * a první položka je ta, kterou si napsal sám. Nadiktoval by si ji úplně kdokoli,
 * pouhou hlavičkou. Pro rate-limit to znamenalo, že se obejde změnou hlavičky
 * u každého dotazu; jako vstup pro řízení přístupu by to znamenalo, že si každý
 * otevře libovolnou adresu — tedy dveře bez zámku.
 *
 * ⭐ ZPRAVA JE TO NAOPAK FAIL-SAFE
 * Poslední položky připsaly NAŠE prvky. Když se zprava přeskočí vše, co je
 * v seznamu důvěryhodných proxy, zůstane poslední adresa, kterou už žádný náš
 * prvek nepřipsal — tedy skutečný klient. Cokoli si návštěvník připsal, zůstane
 * VLEVO od ní a nemá vliv. Útočník totiž ovládá jen levý konec řetězu.
 *
 * ⛔ PRÁZDNÝ SEZNAM PROXY NENÍ „VOLNĚJŠÍ NASTAVENÍ"
 * Bez něj se vrátí adresa naší vlastní proxy — všichni by spadli do jednoho
 * kbelíku. Pro rate-limit je to jen přísné, pro dveře je to fail-open: kdokoli
 * zaťuká, otevře adresu naší infrastruktury, a tou chodí všichni. Proto se
 * seznam pro dveře vyžaduje a jeho absence se řeší odmítnutím, ne domněnkou
 * (`requireTrustedProxies`).
 *
 * Souvisí: `spa-knockd.mjs#clientIpFrom` (týž výpočet na straně listeneru),
 * analýze PoC vs. návrh (2026-08-06, instanční dokumentace).
 */

/** Hlavička může dorazit jako jedna hodnota i jako pole — obojí je týž řetěz. */
export type HeaderValue = string | string[] | undefined;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_S_PORTEM = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const V6_V_ZAVORCE = /^\[([^\]]+)\](?::\d+)?$/;
const V4_MAPOVANA = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Srovná zápisy téže adresy na jeden tvar.
 *
 * Bez tohohle by porovnání se seznamem proxy tiše míjelo: socket dodá adresu
 * v mapovaném tvaru (`::ffff:<v4>`), konfigurace ji má holou, shoda nevyjde —
 * a důvěryhodná proxy se začne tvářit jako klient. Selhalo by to POTICHU a správným směrem
 * (přísněji), takže by si toho nikdo nevšiml, dokud by to nevadilo.
 */
export function normalizeIp(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  const vZavorce = V6_V_ZAVORCE.exec(s);
  if (vZavorce) s = vZavorce[1];
  else {
    const sPortem = IPV4_S_PORTEM.exec(s);
    if (sPortem) s = sPortem[1];
  }

  const mapovana = V4_MAPOVANA.exec(s);
  if (mapovana) s = mapovana[1];

  if (IPV4.test(s)) {
    // `1.2.3.400` projde regulárním výrazem, ale adresa to není. Neplatný vstup
    // se zahazuje, ne opravuje — z „skoro adresy" nejde odvodit, co měl kdo na mysli.
    const oktety = s.split('.').map(Number);
    if (oktety.some((o) => o > 255)) return null;
    return s;
  }
  // IPv6 se nenormalizuje do kanonického tvaru (to by chtělo plný parser);
  // porovnává se malými písmeny, což pokrývá běžné zápisy z proxy.
  if (s.includes(':')) return s.toLowerCase();
  return null;
}

function v4NaCislo(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

/**
 * Jeden záznam seznamu důvěryhodných proxy: přesná adresa nebo IPv4 CIDR.
 *
 * CIDR tu není pro pohodlí — kontejnery dostávají adresu z docker sítě a ta se
 * mění při každém přenasazení. Seznam vypsaný po jedné adrese by tiše zastaral
 * a brána by pak za klienta považovala vlastní proxy.
 */
export type TrustedEntry = { kind: 'exact'; value: string } | { kind: 'cidr'; base: number; mask: number };

export function parseTrusted(entries: readonly string[]): TrustedEntry[] {
  const out: TrustedEntry[] = [];
  for (const raw of entries) {
    const s = raw.trim();
    if (!s) continue;
    const lomeno = s.indexOf('/');
    if (lomeno > 0) {
      const base = v4NaCislo(s.slice(0, lomeno));
      const bity = Number(s.slice(lomeno + 1));
      if (base === null || !Number.isInteger(bity) || bity < 0 || bity > 32) continue;
      const mask = bity === 0 ? 0 : (0xffffffff << (32 - bity)) >>> 0;
      out.push({ kind: 'cidr', base: (base & mask) >>> 0, mask });
      continue;
    }
    const norm = normalizeIp(s);
    if (norm) out.push({ kind: 'exact', value: norm });
  }
  return out;
}

export function jeDuveryhodna(ip: string, trusted: readonly TrustedEntry[]): boolean {
  const cislo = v4NaCislo(ip);
  for (const t of trusted) {
    if (t.kind === 'exact') {
      if (t.value === ip) return true;
    } else if (cislo !== null && ((cislo & t.mask) >>> 0) === t.base) {
      return true;
    }
  }
  return false;
}

/** Rozloží hlavičku na řetěz adres; nečitelné položky vypadnou. */
export function parseChain(raw: HeaderValue): string[] {
  if (raw === undefined) return [];
  const spojene = Array.isArray(raw) ? raw.join(',') : raw;
  return spojene
    .split(',')
    .map((s) => normalizeIp(s))
    .filter((s): s is string => s !== null);
}

/**
 * Klient podle hlavičky — zprava, přes seznam našich proxy.
 *
 * Vrací `null`, když se rozhodnout nedá (hlavička chybí, je nečitelná, nebo jsou
 * v ní samé důvěryhodné proxy). `null` NENÍ „nevadí, vezmi něco jiného" — je to
 * odpověď „nevím", se kterou se volající musí vypořádat sám. Dveře na ni musí
 * zavřít; rate-limit smí spadnout na adresu socketu.
 */
export function clientIpFrom(raw: HeaderValue, trusted: readonly TrustedEntry[]): string | null {
  const chain = parseChain(raw);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!jeDuveryhodna(chain[i], trusted)) return chain[i];
  }
  return null;
}
