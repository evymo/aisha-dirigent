/**
 * Kam smí plugin z sandboxu volat — ze SCHVÁLENÉ sandbox politiky pluginu.
 *
 * ⛔ NAMĚŘENO 2026-09-26 (produkce instance): broker bral povolené hostitele
 * i RPC jen z proměnných služby `PLUGIN_NETWORK_ALLOWLIST` / `PLUGIN_RPC_WHITELIST`
 * a ty byly prázdné — každý schválený plugin by na prvním volání dodavatele
 * i na prvním zápisu dostal 403. Manifest přitom hostitele nesl
 * (`sandbox.network_allowlist`), jen ho nikdo nečetl.
 *
 * ⭐ Zdroj pravdy je politika v katalogu (`get_plugin_sandbox_policy`): je součástí
 * toho, co člověk schvaluje, a plugin mimo canary/ga dostane prázdné seznamy.
 * Proměnná instance smí seznam jen ZÚŽIT (průnik), nikdy rozšířit — prázdná
 * proměnná znamená „instance nic navíc neomezuje", ne „nic nesmí".
 *
 * Mezipaměť 60 s: plugin volá dodavatele v cyklu (knihy jízd po vozidlech);
 * dotaz do DB na každé volání by zátěž násobil. Odvolané schválení se tedy
 * projeví nejpozději do minuty.
 */
import { config } from './config.js';
import { rpcService } from './postgrest.js';

export interface SandboxPolitika {
  schvaleno: boolean;
  /** Jméno zdroje ze `source_spec` — pod jiným plugin do obecných drah nezapíše. */
  zdroj: string | null;
  hosty: string[];
  rpc: string[];
}

interface PolitikaZDb {
  schvaleno?: boolean;
  source_slug?: unknown;
  network_allowlist?: unknown;
  rpc_allowlist?: unknown;
}

const TTL_MS = 60_000;
const mezipamet = new Map<string, { at: number; politika: SandboxPolitika }>();

const retezce = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

/** Průnik s omezením instance; prázdné omezení = instance nic navíc nezužuje. */
export function zuzit(zManifestu: string[], zInstance: string[]): string[] {
  return zInstance.length === 0 ? zManifestu : zManifestu.filter((x) => zInstance.includes(x));
}

export interface PolitikaDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  ted: () => number;
  instanceHosty: string[];
  instanceRpc: string[];
}

const vychoziDeps = (): PolitikaDeps => ({
  rpc: (fn, args) => rpcService(fn, args),
  ted: () => Date.now(),
  instanceHosty: config.networkAllowlist,
  instanceRpc: config.rpcWhitelist,
});

/**
 * Politika pluginu `slug`. Selhání čtení se NEPŘEKLÁDÁ na povolení ani na zákaz —
 * vyhodí chybu a broker odpoví 503 (plugin to zkusí v dalším termínu).
 */
export async function politikaPluginu(slug: string, deps: PolitikaDeps = vychoziDeps()): Promise<SandboxPolitika> {
  const ulozena = mezipamet.get(slug);
  if (ulozena && deps.ted() - ulozena.at < TTL_MS) return ulozena.politika;

  const z = ((await deps.rpc('get_plugin_sandbox_policy', { p_plugin_slug: slug })) ?? {}) as PolitikaZDb;
  const politika: SandboxPolitika = {
    schvaleno: z.schvaleno === true,
    zdroj: typeof z.source_slug === 'string' && z.source_slug !== '' ? z.source_slug : null,
    hosty: zuzit(retezce(z.network_allowlist), deps.instanceHosty),
    rpc: zuzit(retezce(z.rpc_allowlist), deps.instanceRpc),
  };
  mezipamet.set(slug, { at: deps.ted(), politika });
  return politika;
}

/**
 * Které argumenty RPC JMENUJÍ ZDROJ — třída podle tvaru jména, ne výčet funkcí:
 *   - parametr `p_source`, `p_source_slug` a `p_<cokoli>_source(_slug)` (např. `p_to_source`
 *     u twin_identity_propose_match). NE `p_source_key` / `p_source_ref` — to je klíč UVNITŘ zdroje;
 *   - o úroveň níž pole `source` / `source_slug` objektu, který parametr nese přímo nebo v poli
 *     (`p_events[].source` u twin_record_events_audited).
 * Hlouběji se nečte: tam leží data dodavatele (`p_rows[].fields`), kde `source` znamená cokoli.
 */
const PARAMETR_ZDROJE = /^p_(?:[a-z0-9]+_)*source(?:_slug)?$/;
const POLE_ZDROJE = /^source(?:_slug)?$/;

/**
 * Hodnota patří zdroji pluginu: přesně jeho jméno, nebo podzdroj `<zdroj>:<podzdroj>` — jmenný prostor
 * TÉHOŽ zdroje (eurowag: `eurowag-telematics:trip`). Podzdroj je neprázdný a bez další `:`, ať nevznikne
 * dvojí výklad (`a:b:c` = podzdroj `b:c` zdroje `a`, nebo podzdroj `c` zdroje `a:b`?).
 */
function patriZdroji(hodnota: unknown, zdroj: string): boolean {
  if (typeof hodnota !== 'string') return false;
  if (hodnota === zdroj) return true;
  const podzdroj = hodnota.startsWith(`${zdroj}:`) ? hodnota.slice(zdroj.length + 1) : '';
  return podzdroj !== '' && !podzdroj.includes(':');
}

const jeObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * První argument, který jmenuje zdroj a NEPATŘÍ zdroji pluginu (cesta, např. `p_events[3].source`),
 * nebo null. Plugin bez zdroje — a běh, který pluginem není — nesmí takový argument poslat vůbec.
 * Důvod: obecné dráhy (katalog zdroje, dvojčata, události, párování) klíčují data jménem zdroje;
 * pod cizím jménem by plugin přepsal, u snapshotu i smazal data jiného zdroje.
 */
export function ciziZdroj(zdroj: string | null, params: Record<string, unknown>): string | null {
  const cizi = (cesta: string, hodnota: unknown) => (zdroj !== null && patriZdroji(hodnota, zdroj) ? null : cesta);
  const vObjektu = (cesta: string, o: Record<string, unknown>): string | null => {
    for (const [k, v] of Object.entries(o)) {
      if (POLE_ZDROJE.test(k) && cizi(`${cesta}.${k}`, v)) return `${cesta}.${k}`;
    }
    return null;
  };
  for (const [k, v] of Object.entries(params)) {
    if (PARAMETR_ZDROJE.test(k) && cizi(k, v)) return k;
    if (jeObjekt(v)) {
      const n = vObjektu(k, v);
      if (n) return n;
    } else if (Array.isArray(v)) {
      for (const [i, polozka] of v.entries()) {
        const n = jeObjekt(polozka) ? vObjektu(`${k}[${i}]`, polozka) : null;
        if (n) return n;
      }
    }
  }
  return null;
}

/** Jen pro testy. */
export function vyprazdnitMezipamet(): void {
  mezipamet.clear();
}
