import type { PripojeniBehu } from './svazek-behu.js';
import { TVAR_UZIVATELE_BEHU } from '../config-validace.js';

/**
 * JEDINÉ místo, které skládá požadavek na kontejner běhu (`containers/create`).
 *
 * ⛔ 2026-10-06 (majitel „síť zavřít“, volba A; rada cb K1/K6/K7): požadavek skládaly tři
 * backendy každý sám — docker a kata nesly v prostředí klíč k mesh síti (`NB_SETUP_KEY`),
 * kata neměla kořen jen pro čtení ani `CapDrop`, nikdo nevynucoval `PidsLimit` ani
 * uživatele (běžel ten z obrazu, tedy klidně root). Teď všechny backendy volají tohle
 * místo a invarianty jsou v něm, ne v disciplíně volajících:
 *
 *   - jen síť běhů (`NetworkMode` + jediný endpoint), žádná druhá síť,
 *   - `PidsLimit` > 0 a číselný uživatel ≠ 0 vždy z konfigurace runneru, ne z obrazu,
 *   - `CapDrop: ALL` + `no-new-privileges` vždy,
 *   - prostředí bez `NB_*` (klíč k mesh síti běh nedostane — ani omylem volajícího).
 *
 * Modul je ČISTÝ (žádné I/O, žádná konfigurace) — brána `beh-kontejneru-tvar` ho volá
 * přímo a měří vlastnost výstupu, ne text zdrojáku.
 */


/** Předpona proměnných klienta mesh sítě (NetBird). Běh je nikdy nedostane. */
const PREDPONA_MESH = /^NB_/i;

export interface RunContainerSpec {
  image: string;
  /** Síť běhů (`DOCKER_EXEC_NETWORK`) — uzavřenost měří docker-http.ts ensureExecNetwork před voláním. */
  network: string;
  env: string[];
  /** Číselné uid[:gid] ≠ 0. */
  user: string;
  /** Strop procesů/vláken > 0. */
  pidsLimit: number;
  memoryBytes: number;
  cpuQuota: number;
  cpuPeriod: number;
  /** true pro běh pluginu; claude_cli_task potřebuje zapisovatelný kořen (pracovní strom). */
  readonlyRootfs: boolean;
  tmpfs?: Record<string, string>;
  binds?: string[];
  mounts?: PripojeniBehu[];
  /** Kata runtime (`kata-fc`, `kata-dragonball`); bez něj runc. */
  runtime?: string;
  workingDir?: string;
  labels?: Record<string, string>;
}

/** Proměnné prostředí, které nesou klíč/adresu mesh sítě — prázdné pole = čisté. */
export function meshPromenneVProstredi(env: readonly string[]): string[] {
  return env.map((e) => e.split('=', 1)[0] ?? '').filter((k) => PREDPONA_MESH.test(k));
}

/**
 * Složí tělo `POST /containers/create`. Porušený invariant = výjimka (fail-closed),
 * kontejner se pak nezaloží — nikdy „opravené“ ticho.
 */
export function buildRunContainerBody(spec: RunContainerSpec): Record<string, unknown> {
  if (!spec.image) throw new Error('kontejner běhu: chybí obraz');
  if (!spec.network) throw new Error('kontejner běhu: chybí síť běhů');
  if (!TVAR_UZIVATELE_BEHU.test(spec.user)) {
    throw new Error('kontejner běhu: uživatel musí být číselné uid[:gid] různé od 0 (root)');
  }
  if (!Number.isInteger(spec.pidsLimit) || spec.pidsLimit <= 0) {
    throw new Error('kontejner běhu: PidsLimit musí být celé kladné číslo');
  }
  const mesh = meshPromenneVProstredi(spec.env);
  if (mesh.length > 0) {
    throw new Error(`kontejner běhu: prostředí nese proměnné mesh sítě (${mesh.join(', ')}) — běh klíč k mesh síti nedostane`);
  }

  const hostConfig: Record<string, unknown> = {
    NetworkMode: spec.network,
    Memory: spec.memoryBytes,
    CpuQuota: spec.cpuQuota,
    CpuPeriod: spec.cpuPeriod,
    PidsLimit: spec.pidsLimit,
    SecurityOpt: ['no-new-privileges:true'],
    CapDrop: ['ALL'],
    ReadonlyRootfs: spec.readonlyRootfs,
    AutoRemove: false,
  };
  if (spec.tmpfs) hostConfig['Tmpfs'] = spec.tmpfs;
  if (spec.binds && spec.binds.length > 0) hostConfig['Binds'] = spec.binds;
  if (spec.mounts?.length) hostConfig['Mounts'] = spec.mounts;
  if (spec.runtime) hostConfig['Runtime'] = spec.runtime;

  return {
    Image: spec.image,
    User: spec.user,
    ...(spec.workingDir ? { WorkingDir: spec.workingDir } : {}),
    // JEN síť běhů — žádná druhá síť (2026-09-30 tu byla napevno síť jiné instance).
    NetworkingConfig: { EndpointsConfig: { [spec.network]: {} } },
    HostConfig: hostConfig,
    ...(spec.labels ? { Labels: spec.labels } : {}),
    Env: [...spec.env],
  };
}

/** `512m` / `1g` / bajty → bajty. Nečitelná hodnota = 256 MiB (beze změny proti dřívějšku). */
export function parseMemoryLimit(limit: string): number {
  const m = limit.match(/^(\d+)([kmg]?)$/i);
  if (!m) return 256 * 1024 * 1024;
  const val = parseInt(m[1] ?? '0', 10);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'k': return val * 1024;
    case 'm': return val * 1024 * 1024;
    case 'g': return val * 1024 * 1024 * 1024;
    default: return val;
  }
}
