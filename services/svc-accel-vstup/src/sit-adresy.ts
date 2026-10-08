/**
 * IPv4 adresy a podsítě vstupů. Jen IPv4: sítě lane mají IPv6 vypnuté a VB naslouchá
 * jen na IPv4. Adresa ve tvaru `::ffff:a.b.c.d` (dual-stack socket) se převede.
 */
export interface Podsit {
  sit: number;
  maska: number;
  zapis: string;
}

/** IPv4 → číslo; cokoli jiného (i IPv6 mimo ::ffff:) je výjimka. */
export function ipNaCislo(ip: string): number {
  const ciste = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const casti = ciste.split('.');
  if (casti.length !== 4) throw new Error(`'${ip}' není IPv4 adresa`);
  let n = 0;
  for (const c of casti) {
    if (!/^\d{1,3}$/.test(c) || Number(c) > 255) throw new Error(`'${ip}' není IPv4 adresa`);
    n = n * 256 + Number(c);
  }
  return n >>> 0;
}

export function parsujPodsit(cidr: string): Podsit {
  const [adresa, delka] = cidr.split('/');
  const d = Number(delka);
  if (!Number.isInteger(d) || d < 8 || d > 30) throw new Error(`'${cidr}': délka prefixu musí být 8–30`);
  const maska = d === 0 ? 0 : (0xffffffff << (32 - d)) >>> 0;
  const sit = (ipNaCislo(adresa) & maska) >>> 0;
  if (sit !== ipNaCislo(adresa)) throw new Error(`'${cidr}': adresa není začátek podsítě`);
  return { sit, maska, zapis: cidr };
}

export function ipVPodsiti(ip: string, p: Podsit): boolean {
  try {
    return ((ipNaCislo(ip) & p.maska) >>> 0) === p.sit;
  } catch {
    return false;
  }
}

/** `vnitrni` leží celá ve `vnejsi` (stejná nebo delší maska, týž začátek po masce vnější). */
export function podsitUvnitr(vnitrni: Podsit, vnejsi: Podsit): boolean {
  return ((vnitrni.maska & vnejsi.maska) >>> 0) === vnejsi.maska && ((vnitrni.sit & vnejsi.maska) >>> 0) === vnejsi.sit;
}

/** Číslo adresy (ipNaCislo) leží v podsíti. */
export function cisloVPodsiti(n: number, p: Podsit): boolean {
  return ((n & p.maska) >>> 0) === p.sit;
}

export function podsiteSePrekryvaji(a: Podsit, b: Podsit): boolean {
  const maska = (a.maska & b.maska) >>> 0;
  return ((a.sit & maska) >>> 0) === ((b.sit & maska) >>> 0);
}

/** Normalizovaná IPv4 podoba adresy socketu (bez `::ffff:`), nebo null pro IPv6. */
export function normalizujAdresu(ip: string | undefined): string | null {
  if (!ip) return null;
  try {
    ipNaCislo(ip);
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  } catch {
    return null;
  }
}
