import * as http from 'node:http';
import { config } from '../config.js';

// ── Docker Engine API přes unixový socket ───────────────────────────────────
// Jediný klient pro oba backendy (plugin `docker.ts` i `claude-cli.ts`).
//
// ⛔ NAMĚŘENO 2026-09-30 na instanci (Docker 29.7.2, API 1.55): dřívější ručně psaný
// klient (`net.createConnection` + řetězec `HTTP/1.1`) bral tělo odpovědi tak,
// jak přišlo po drátě. Docker odpovídá `Transfer-Encoding: chunked`, takže tělo
// začínalo délkou úseku („1270\r\n[…]“) a `JSON.parse` padl na „Unexpected
// non-whitespace character after JSON at position 6 (line 2 column 1)“ — každý
// běh pluginu skončil hned na prvním dotazu (GET /networks). Dvě vady před ní
// (EACCES na socketu, cesta `/1.45` bez „v“) to skrývaly: k volání se běh
// vůbec nedostal.
//
// `node:http` přenosové kódování rozloží sám. Tělo se skládá z BAJTŮ a na text
// se převádí až celé — vícebajtový znak na hranici dvou kusů se nerozbije.

export function dockerRequest(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : '';
    const req = http.request(
      {
        socketPath: config.dockerSocket,
        path,
        method,
        headers: {
          Host: 'localhost',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => { parts.push(c); });
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }); });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

export async function dockerJSON<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await dockerRequest(method, path, body);
  if (res.status >= 400) {
    throw new Error(`Docker API ${method} ${path} => ${res.status}: ${res.body.slice(0, 200)}`);
  }
  return JSON.parse(res.body) as T;
}

/**
 * Start kontejneru — odpověď se ČTE.
 *
 * ⛔ NAMĚŘENO 2026-09-30 na instanci: start končil chybou (síť `aisha-network`
 * neexistovala), ale odpověď nikdo nečetl. Docker pak kontejneru nastavil
 * ExitCode 128 a běh hlásil jen „Exit code 128“ bez důvodu. 204 = spuštěn,
 * 304 = už běží; cokoli jiného je chyba i se zprávou Dockeru.
 */
export async function dockerStart(apiBase: string, containerId: string): Promise<void> {
  const res = await dockerRequest('POST', `${apiBase}/containers/${containerId}/start`);
  if (res.status !== 204 && res.status !== 304) {
    throw new Error(`Docker API POST ${apiBase}/containers/${containerId}/start => ${res.status}: ${res.body.slice(0, 300)}`);
  }
}

/**
 * Izolační síť běhů (`DOCKER_EXEC_NETWORK`, jméno nese identitu instance) — UZAVŘENÁ.
 *
 * ⛔ 2026-10-06 (majitel „síť zavřít“ = volba A; rada cb K2/K3, T2–T5, T9): síť dřív
 * vznikala jako obyčejný `bridge` (výchozí brána + NAT ven) a runner si pamatoval
 * „ověřeno“. Plugin, který vystoupí z VM, tak volal internet, hostitele i ostatní
 * kontejnery mimo broker. Teď:
 *
 *   - síť vzniká s `Internal: true` — žádná výchozí trasa; jediný soused, který v ní
 *     něco obsluhuje, je runner s broker-proxy (broker-proxy.ts),
 *   - a s `com.docker.network.bridge.inhibit_ipv4=true` — HOSTITEL v ní nemá adresu.
 *     ⛔ NAMĚŘENO 2026-10-07 (Docker 29.7.2, místní sonda): z `Internal` sítě BEZ téhle
 *     volby se běh spojil s posluchačem hostitele na adrese brány bridge (172.x.0.1) —
 *     tedy s čímkoli, co na hostiteli poslouchá na 0.0.0.0. S volbou bridge adresu nemá,
 *     soused na L2 (runner) zůstává dosažitelný. Měří se i výsledek: síť s bránou v IPAM
 *     se odmítne (starší Docker volbu nezná → bránu přidělí → runner síť nepoužije),
 *   - EXISTUJÍCÍ síť toho jména, která uzavřená NENÍ, se odmítne hlasitou chybou —
 *     nikdy se tiše nepoužije ani „nevaruje a nepokračuje“,
 *   - měří se před KAŽDÝM během (žádná paměť): síť, kterou mezitím někdo nahradil
 *     otevřenou, se pozná u dalšího běhu,
 *   - nečitelná / jiná odpověď Dockeru = chyba, kontejner se nezaloží.
 */
/** Volba bridge: hostitel v síti běhů nedostane IPv4 adresu (žádná brána k hostiteli). */
const BEZ_ADRESY_HOSTITELE = 'com.docker.network.bridge.inhibit_ipv4';

export async function ensureExecNetwork(): Promise<void> {
  const jmeno = config.dockerExecNetwork;
  if (!jmeno) throw new Error('DOCKER_EXEC_NETWORK není nastavená — běh se nespustí');
  const apiBase = '/' + config.dockerApiVersion;
  const chyba = (proc: string): Error => new Error(`síť běhů '${jmeno}': ${proc} — běh se nespustí`);

  const zmer = async (): Promise<'chybi' | 'uzavrena'> => {
    let res: { status: number; body: string };
    try {
      res = await dockerRequest('GET', `${apiBase}/networks/${encodeURIComponent(jmeno)}`);
    } catch (err) {
      throw chyba(`nejde změřit (${err instanceof Error ? err.message : String(err)})`);
    }
    if (res.status === 404) return 'chybi';
    if (res.status >= 400) throw chyba(`Docker odpověděl ${res.status}`);
    let sit: unknown;
    try {
      sit = JSON.parse(res.body);
    } catch {
      throw chyba('odpověď Dockeru není čitelný JSON');
    }
    if (!sit || typeof sit !== 'object' || Array.isArray(sit)) throw chyba('odpověď Dockeru nemá tvar sítě');
    const n = sit as { Name?: unknown; Internal?: unknown; Options?: Record<string, unknown> | null; IPAM?: { Config?: unknown } };
    // Docker hledá i podle PŘEDPONY id — jiná síť se stejnou předponou není naše síť.
    if (n.Name !== jmeno) throw chyba(`Docker vrátil jinou síť (${String(n.Name)})`);
    if (n.Internal !== true) {
      throw chyba(
        `NENÍ uzavřená (Internal=${String(n.Internal)}) — kontejner na ní má výchozí bránu ven, runner ji nepoužije. ` +
          'Síť toho jména je třeba odstranit; runner ji založí znovu s Internal: true',
      );
    }
    const zakazIp = n.Options?.[BEZ_ADRESY_HOSTITELE];
    const konfig = Array.isArray(n.IPAM?.Config) ? (n.IPAM!.Config as Array<{ Gateway?: unknown } | null>) : [];
    const brany = konfig.map((c) => c?.Gateway).filter((g): g is string => typeof g === 'string' && g !== '');
    if (zakazIp !== 'true' || brany.length > 0) {
      throw chyba(
        `hostitel v ní má adresu (brána ${brany.join(', ') || 'neuvedena'}, ${BEZ_ADRESY_HOSTITELE}=${String(zakazIp)}) — ` +
          'z běhu by byl dosažitelný každý posluchač hostitele. Síť toho jména je třeba odstranit; runner ji založí znovu bez adresy hostitele',
      );
    }
    return 'uzavrena';
  };

  if ((await zmer()) === 'uzavrena') return;
  const res = await dockerRequest('POST', `${apiBase}/networks/create`, {
    Name: jmeno,
    Driver: 'bridge',
    Internal: true,
    EnableIPv6: false,
    Options: { [BEZ_ADRESY_HOSTITELE]: 'true' },
  });
  // 409 = mezitím ji založil souběžný běh — rozhodne nové měření níž, ne tahle odpověď.
  if (res.status >= 400 && res.status !== 409) {
    throw chyba(`založení selhalo: Docker API POST ${apiBase}/networks/create => ${res.status}: ${res.body.slice(0, 200)}`);
  }
  // Měří se, co Docker SKUTEČNĚ založil (ne co jsme poslali).
  if ((await zmer()) !== 'uzavrena') throw chyba('ani po založení neexistuje');
}

type InspekceKontejneru = {
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string; Aliases?: string[] | null } | undefined> };
  Mounts?: unknown;
};

/**
 * Připojí runner SÁM k exec síti pod aliasem broker-proxy a vrátí jeho adresu v ní.
 *
 * Síť zakládá runner až za běhu (ensureExecNetwork), takže ji compose deklarovat
 * nemůže — na čisté instanci by ještě neexistovala. Kontejner se proto připojí
 * přes Docker API. Připojení bez aliasu (starší start) se odpojí a připojí znovu:
 * bez aliasu by sandbox jméno proxy nepřeložil.
 */
export async function pripojKExecSiti(alias: string): Promise<string> {
  await ensureExecNetwork();
  const ja = process.env.HOSTNAME ?? '';
  if (!ja) throw new Error('HOSTNAME chybí — runner nezná vlastní kontejner, k exec síti se nepřipojí');
  const apiBase = '/' + config.dockerApiVersion;
  const sit = encodeURIComponent(config.dockerExecNetwork);
  const kontejner = encodeURIComponent(ja);

  const inspekce = (): Promise<InspekceKontejneru> => dockerJSON<InspekceKontejneru>('GET', `${apiBase}/containers/${kontejner}/json`);
  const pripoj = async (): Promise<void> => {
    // GwPriority < 0: exec síť se NIKDY nestane výchozí trasou runneru (mesh trasa
    // a výchozí brána zůstávají, kde jsou); starší API pole ignoruje.
    const res = await dockerRequest('POST', `${apiBase}/networks/${sit}/connect`, { Container: ja, EndpointConfig: { Aliases: [alias], GwPriority: -1 } });
    if (res.status !== 200) {
      throw new Error(`Docker API POST ${apiBase}/networks/${sit}/connect => ${res.status}: ${res.body.slice(0, 300)}`);
    }
  };

  let ep = (await inspekce()).NetworkSettings?.Networks?.[config.dockerExecNetwork];
  if (ep && !(ep.Aliases ?? []).includes(alias)) {
    const res = await dockerRequest('POST', `${apiBase}/networks/${sit}/disconnect`, { Container: ja, Force: true });
    if (res.status !== 200) {
      throw new Error(`Docker API POST ${apiBase}/networks/${sit}/disconnect => ${res.status}: ${res.body.slice(0, 300)}`);
    }
    ep = undefined;
  }
  if (!ep) {
    await pripoj();
    ep = (await inspekce()).NetworkSettings?.Networks?.[config.dockerExecNetwork];
  }
  if (!ep?.IPAddress) throw new Error(`runner nemá adresu v síti ${config.dockerExecNetwork} ani po připojení`);
  return ep.IPAddress;
}

/**
 * Adresy runneru ve VŠECH sítích kromě sítě běhů — jediné místní adresy, na kterých smí
 * API runneru (spouští kontejnery přes docker.sock) obsluhovat spojení.
 *
 * ⛔ 2026-10-07 (revize D6): API odmítalo jen spojení na ZNÁMOU adresu runneru v síti
 * běhů; dokud nebyla známá (před prvním připojením, po jeho selhání, po náhradě sítě),
 * pouštělo VŠE — osiřelý běh z minulé generace runneru na API dosáhl. Teď se seznam
 * povolených adres měří (výčet, ne zákaz): co v něm není, API neobslouží.
 */
export async function adresyRunneruMimoExecSit(): Promise<string[]> {
  const ja = process.env.HOSTNAME ?? '';
  if (!ja) throw new Error('HOSTNAME chybí — runner nezná vlastní kontejner, adresy API nezměří');
  const apiBase = '/' + config.dockerApiVersion;
  const inspekce = await dockerJSON<InspekceKontejneru>('GET', `${apiBase}/containers/${encodeURIComponent(ja)}/json`);
  const site = inspekce.NetworkSettings?.Networks;
  if (!site || typeof site !== 'object') throw new Error('Docker nevrátil sítě kontejneru runneru — adresy API nezměří');
  return Object.entries(site)
    .filter(([jmeno]) => jmeno !== config.dockerExecNetwork)
    .map(([, ep]) => ep?.IPAddress ?? '')
    .filter((ip) => ip !== '');
}

/**
 * Připojení (`Mounts`) kontejneru runneru, jak je vidí Docker — vstup pro `pripojeniBehu`
 * (svazek-behu.ts): dítě dostane TÝŽ zdroj, do kterého runner klonuje, bez druhé deklarace
 * cesty v env (Coolify `${VAR}` ve zdroji svazku převede na pojmenovaný svazek, 2026-09-28).
 * Měří se u KAŽDÉHO běhu — náhrada svazku mezi nasazeními se tak pozná.
 */
export async function mountyRunneru(): Promise<unknown> {
  const ja = process.env.HOSTNAME ?? '';
  if (!ja) throw new Error('HOSTNAME chybí — runner nezná vlastní kontejner, adresář běhů dítěti nepředá');
  const apiBase = '/' + config.dockerApiVersion;
  const inspekce = await dockerJSON<InspekceKontejneru>('GET', `${apiBase}/containers/${encodeURIComponent(ja)}/json`);
  return inspekce.Mounts;
}
