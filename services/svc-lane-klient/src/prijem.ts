/**
 * Kdo smí na tenkého klienta: jen peery modelového meshe forku.
 *
 * Klient sedí ve jmenném prostoru agenta modelového meshe, takže má rozhraní meshe
 * (`wt0`) i rozhraní sítě `<prefix>-lane`, kde stojí vynucovací bod. Spojení přijme
 * jen tehdy, když přišlo NA adresu meshe a Z jeho rozsahu. Cokoli jiného — hlavně
 * spojení ze sítě lane — zavře bez odpovědi. Je to pojistka M6/O8: lane nikdy
 * nezahajuje do forku a klient nikdy není most z lane do meshe.
 *
 * Rozsah se MĚŘÍ z rozhraní (adresa a maska, jak je přidělil management meshe),
 * nikdy se nekonfiguruje: konfigurovaný rozsah by se rozešel s tím, co agent opravdu
 * má. Rozhraní chybí nebo je nejednoznačné = nepustí nikoho (NEZMĚŘENO ≠ povoleno).
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type Rozhrani = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface Rozsah {
  /** Adresa klienta v meshi (lokální adresa přijatého spojení musí být přesně tahle). */
  adresa: string;
  prefix: number;
}

/** Nejširší rozsah, který ještě bereme jako změřený (mesh přiděluje /16; /0 by pustilo všechno). */
const NEJSIRSI_PREFIX = 8;

function ipv4(a: string | undefined): number | null {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a ?? '');
  if (!m) return null;
  const c = m.slice(1).map(Number);
  if (c.some((x) => x > 255)) return null;
  return ((c[0] << 24) >>> 0) + (c[1] << 16) + (c[2] << 8) + c[3];
}

/** Rozsah meshe změřený z rozhraní; `null` = rozhraní chybí, má víc IPv4 adres nebo nesmyslnou masku. */
export function rozsahMeshe(jmeno: string, rozhrani: Rozhrani = networkInterfaces): Rozsah | null {
  const v4 = (rozhrani()[jmeno] ?? []).filter((i) => i.family === 'IPv4' && !i.internal);
  if (v4.length !== 1) return null;
  const [adresa, p] = (v4[0].cidr ?? '').split('/');
  const prefix = Number(p);
  if (ipv4(adresa) === null || !Number.isInteger(prefix) || prefix < NEJSIRSI_PREFIX || prefix > 32) return null;
  return { adresa, prefix };
}

/** Smí spojení dál? Přišlo na adresu meshe (ne na adresu lane) a ze stejného rozsahu. */
export function prijmout(spojeni: { lokalni?: string; vzdalena?: string }, r: Rozsah | null): boolean {
  if (!r) return false;
  const vlastni = ipv4(r.adresa)!;
  const lokalni = ipv4(spojeni.lokalni);
  const vzdalena = ipv4(spojeni.vzdalena);
  if (lokalni === null || vzdalena === null || lokalni !== vlastni) return false;
  const maska = (0xffffffff << (32 - r.prefix)) >>> 0;
  return ((vzdalena & maska) >>> 0) === ((vlastni & maska) >>> 0);
}
