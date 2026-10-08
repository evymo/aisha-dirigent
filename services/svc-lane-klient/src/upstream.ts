import { readFileSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/**
 * Jediný upstream tenkého klienta: vynucovací bod lane, jeho IPv4 adresa na síti `<prefix>-lane`
 * (pevná z deklarace uzlu; fork ji dostává z topologie jako LANE_VSTUP_URL).
 *
 * Hodnota je počátek (`http://<IPv4>:port`), nic víc. Seznam, cesta, dotaz,
 * přihlašovací údaje nebo https znamenají chybu nasazení a klient s ní nenastartuje.
 * Druhý upstream nebo „zkusit jinam“ je mutace MN6/MJ13 a tvar to vylučuje:
 * spojení drží `Pool` svázaný s tímhle jediným počátkem.
 */
export function overUpstream(hodnota: string | undefined): { ok: true; pocatek: string } | { ok: false; vada: string } {
  const h = (hodnota ?? '').trim();
  if (!h) return { ok: false, vada: 'LANE_KLIENT_UPSTREAM chybí' };
  if (/[\s,;]/.test(h)) return { ok: false, vada: 'LANE_KLIENT_UPSTREAM musí být JEDEN počátek (žádný seznam)' };
  let u: URL;
  try {
    u = new URL(h);
  } catch {
    return { ok: false, vada: 'LANE_KLIENT_UPSTREAM není URL' };
  }
  if (u.protocol !== 'http:') return { ok: false, vada: 'LANE_KLIENT_UPSTREAM: jen http (vynucovací bod je na interní síti lane)' };
  if (u.username || u.password) return { ok: false, vada: 'LANE_KLIENT_UPSTREAM nesmí nést přihlašovací údaje' };
  if (!u.port) return { ok: false, vada: 'LANE_KLIENT_UPSTREAM musí mít výslovný port' };
  if (u.pathname !== '/' || u.search || u.hash || /\/./.test(h.replace(/^http:\/\//, ''))) {
    return { ok: false, vada: 'LANE_KLIENT_UPSTREAM je jen počátek, bez cesty a dotazu' };
  }
  // IP, ne jméno: jméno by řešil vestavěný DNS Dockeru napříč VŠEMI sítěmi jmenného prostoru
  // agenta (i `ven`); IP se dá změřit proti podsíti rozhraní lane (naSitiLane).
  if (ipv4(u.hostname) === null) return { ok: false, vada: 'LANE_KLIENT_UPSTREAM musí nést IPv4 adresu vstupu na síti lane, ne jméno' };
  return { ok: true, pocatek: u.origin };
}

function ipv4(a: string | undefined): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a ?? '');
  if (!m) return null;
  const c = m.slice(1).map(Number);
  if (c.some((x) => x > 255)) return null;
  return ((c[0] << 24) >>> 0) + (c[1] << 16) + (c[2] << 8) + c[3];
}

/** Rozhraní s výchozí trasou (Linux `/proc/net/route`, cíl 00000000); null = nečitelné. */
export function rozhraniSVychoziTrasou(cti: () => string = () => readFileSync('/proc/net/route', 'utf8')): Set<string> | null {
  try {
    const radky = cti().split('\n').slice(1).map((r) => r.trim().split(/\s+/)).filter((r) => r.length > 2);
    return new Set(radky.filter((r) => r[1] === '00000000').map((r) => r[0]));
  } catch {
    return null;
  }
}

/**
 * Leží vstup na síti lane? Rozhraní lane se MĚŘÍ: rozhraní mimo mesh BEZ výchozí trasy
 * (lane je `--internal`, nemá bránu; vlastní most stacku `ven` výchozí trasu nese). Adresa
 * vstupu musí ležet v podsíti PRÁVĚ JEDNOHO takového rozhraní. Jinak klient nenastartuje:
 * adresa mimo lane by poslala požadavky i s klíčem jinam (fail-closed, nikdy „zkusit“).
 */
export function naSitiLane(
  pocatek: string,
  mesh: string,
  rozhrani: () => NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces,
  vychozi: () => Set<string> | null = () => rozhraniSVychoziTrasou(),
): { ok: true; rozhrani: string } | { ok: false; vada: string } {
  const cil = ipv4(new URL(pocatek).hostname);
  if (cil === null) return { ok: false, vada: 'adresa vstupu není IPv4' };
  const sTrasou = vychozi();
  if (sTrasou === null) return { ok: false, vada: 'výchozí trasa NEZMĚŘENA (/proc/net/route nečitelné) — síť lane nejde určit' };
  const shody: string[] = [];
  for (const [jmeno, adresy] of Object.entries(rozhrani())) {
    if (jmeno === mesh || sTrasou.has(jmeno)) continue;
    for (const a of adresy ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [ip, p] = (a.cidr ?? '').split('/');
      const vlastni = ipv4(ip);
      const prefix = Number(p);
      if (vlastni === null || !Number.isInteger(prefix) || prefix < 8 || prefix > 30) continue;
      const maska = (0xffffffff << (32 - prefix)) >>> 0;
      if (((cil & maska) >>> 0) === ((vlastni & maska) >>> 0)) shody.push(jmeno);
    }
  }
  if (shody.length === 1) return { ok: true, rozhrani: shody[0] };
  if (shody.length === 0) return { ok: false, vada: 'adresa vstupu neleží v podsíti žádného rozhraní lane (mimo mesh, bez výchozí trasy)' };
  return { ok: false, vada: `adresa vstupu leží ve víc rozhraních (${shody.join(', ')}) — síť lane nejednoznačná` };
}
