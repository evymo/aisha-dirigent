import * as http from 'node:http';
import { config } from '../config.js';

// ── Docker Engine API přes unixový socket ───────────────────────────────────
// Jediný klient pro oba backendy (plugin `docker.ts` i `claude-cli.ts`).
//
// ⛔ NAMĚŘENO 2026-09-30 na riq (Docker 29.7.2, API 1.55): dřívější ručně psaný
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
 * ⛔ NAMĚŘENO 2026-09-30 na riq: start končil chybou (síť `aisha-network`
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

let execNetEnsured = false;

/** Izolační síť běhů (`DOCKER_EXEC_NETWORK`, jméno nese identitu instance) — založí ji runner. */
export async function ensureExecNetwork(): Promise<void> {
  if (execNetEnsured) return;
  const apiBase = '/' + config.dockerApiVersion;
  const networks = await dockerJSON<Array<{ Name: string }>>('GET', apiBase + '/networks');
  if (!networks.find((n) => n.Name === config.dockerExecNetwork)) {
    await dockerJSON('POST', apiBase + '/networks/create', {
      Name: config.dockerExecNetwork,
      Driver: 'bridge',
      EnableIPv6: false,
    });
  }
  execNetEnsured = true;
}
