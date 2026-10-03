/**
 * Měření běhu pluginu: kolikrát a co stahoval, jak rychle odpovídal dodavatel,
 * kolik toho zapsal (2026-09-24, schváleno majitelem: „výkon, stav, odezva
 * a statistiky, kolikrát co jsme stahovali").
 *
 * Broker vidí KAŽDÉ volání ven (/sandbox/fetch) i každý zápis (/sandbox/rpc) —
 * na token běhu, jehož `sub` je run_id. Tady se to sečte; host si metr po běhu
 * vyzvedne (vyzvednoutMetr) a zapíše ho jako jednu událost do
 * plugin_health_events, odkud čte hlídač stavu zdrojů.
 *
 * ⛔ Z URL se bere JEN HOST. Dotaz, cesta, hlavičky ani těla se nikam neukládají —
 * někteří dodavatelé nesou přihlašovací údaje přímo v URL.
 *
 * ⭐ Zápis = položky polí poslané do RPC `*_audited` (zapisovací konvence:
 * wd_upsert_*_audited, twin_record_events_audited…). Čtecí RPC se nepočítají —
 * „zapsáno" nesmí nafouknout dotaz na seznam vozidel.
 *
 * Metr se zakládá na začátku běhu (/sandbox/config) a žije v procesu hostu.
 * Běh, který obsloužila jiná replika, se neztratí tiše: host pak zapíše
 * `http: null` (NEMĚŘENO), ne nuly.
 */

export interface HttpMetr {
  calls: number;
  errors: number;
  bytes_in: number;
  bytes_out: number;
  ms_total: number;
  ms_max: number;
  /** počet volání podle hostitele (bez cesty a dotazu) */
  hosts: Record<string, number>;
}

export interface MetrBehu {
  http: HttpMetr;
  /** počet zapsaných položek podle zapisovací RPC */
  zapsano: Record<string, number>;
  zapsano_celkem: number;
}

interface Zaznam extends MetrBehu {
  zalozeno: number;
}

/** Metr běhu, který si host nevyzvedl (pád hostu uprostřed běhu), se po té době zahodí. */
export const MAX_STARI_METRU_MS = 2 * 60 * 60 * 1000;

const behy = new Map<string, Zaznam>();

function uklid(ted: number): void {
  for (const [runId, z] of behy) {
    if (ted - z.zalozeno > MAX_STARI_METRU_MS) behy.delete(runId);
  }
}

function metr(runId: string): Zaznam {
  let z = behy.get(runId);
  if (!z) {
    const ted = Date.now();
    uklid(ted);
    z = {
      http: { calls: 0, errors: 0, bytes_in: 0, bytes_out: 0, ms_total: 0, ms_max: 0, hosts: {} },
      zapsano: {},
      zapsano_celkem: 0,
      zalozeno: ted,
    };
    behy.set(runId, z);
  }
  return z;
}

function hostZUrl(url: string): string {
  try {
    return new URL(url).host || '(neznámý)';
  } catch {
    return '(neplatná url)';
  }
}

/**
 * Jedno volání ven. `status` null = volání neproběhlo (blokováno, vypršelo,
 * spadlo spojení) — počítá se jako chyba.
 */
export function zaznamenatVolani(
  runId: string | undefined,
  url: string,
  ms: number,
  status: number | null,
  bytesOut: number,
  bytesIn: number,
): void {
  if (!runId) return;
  const z = metr(runId);
  const trvani = Math.max(0, Math.round(ms));
  z.http.calls += 1;
  if (status === null || status >= 400) z.http.errors += 1;
  z.http.bytes_out += Math.max(0, bytesOut);
  z.http.bytes_in += Math.max(0, bytesIn);
  z.http.ms_total += trvani;
  z.http.ms_max = Math.max(z.http.ms_max, trvani);
  const host = hostZUrl(url);
  z.http.hosts[host] = (z.http.hosts[host] ?? 0) + 1;
}

/** Jedno volání RPC; zápisem je jen `*_audited` s polem položek. */
export function zaznamenatZapis(runId: string | undefined, fn: string, params: Record<string, unknown>): void {
  if (!runId || !fn.endsWith('_audited')) return;
  let polozek = 0;
  for (const v of Object.values(params ?? {})) {
    if (Array.isArray(v)) polozek += v.length;
  }
  if (polozek === 0) return;
  const z = metr(runId);
  z.zapsano[fn] = (z.zapsano[fn] ?? 0) + polozek;
  z.zapsano_celkem += polozek;
}

/**
 * Založí metr na začátku běhu (broker ho volá z /sandbox/config, o který si shim
 * řekne jako první). Běh, který pak nic nestáhne, tak vykáže nuly, ne NEMĚŘENO.
 */
export function zalozitMetr(runId: string | undefined): void {
  if (runId) metr(runId);
}

/** Vydá metr běhu a zapomene ho. null = běh nic neměřil (nebo ho obsloužila jiná replika). */
export function vyzvednoutMetr(runId: string | undefined): MetrBehu | null {
  if (!runId) return null;
  const z = behy.get(runId);
  if (!z) return null;
  behy.delete(runId);
  return { http: z.http, zapsano: z.zapsano, zapsano_celkem: z.zapsano_celkem };
}

/** Jen pro testy. */
export function _vycistitMetry(): void {
  behy.clear();
}
