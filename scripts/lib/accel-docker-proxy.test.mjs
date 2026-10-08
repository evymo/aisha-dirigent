// N3 (revize 0c, majitel 2026-10-06): hlídač členství nedostane docker.sock, jen proxy pro čtení.
// Měří se KONFIGURACE, kterou warmup nasadí: povolený GET musí pustit přesně cesty, které hlídač
// volá (hlidac.ts dockerApi), a nic jiného; zápisové metody nesmí být nastavené vůbec.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const compose = parse(readFileSync(join(KOREN, 'docker-compose.coolify-accel-vstup.yml'), 'utf8'));
const proxy = compose.services['accel-docker-proxy'];
const hlidac = compose.services['accel-hlidac'];
const argy = proxy.command.map(String);
const arg = (jm) => argy.filter((a) => a.startsWith(`-${jm}=`)).map((a) => a.slice(jm.length + 2));
// compose zapisuje `$` jako `$$`; proxy dostane jedno.
const reGet = new RegExp(arg('allowGET')[0].replace(/\$\$/g, '$'));

describe('proxy socketu Dockeru jen pro čtení (N3)', () => {
  it('hlídač nemá docker.sock ani síť, mluví jen s proxy', () => {
    expect(JSON.stringify(hlidac.volumes)).not.toMatch(/docker\.sock:/);
    expect(hlidac.network_mode).toBe('none');
    expect(hlidac.environment.DOCKER_SOCKET).toBe('/proxy/docker.sock');
    expect(proxy.network_mode).toBe('none');
  });
  it('povolený je JEN GET; zápisové metody nejsou nastavené', () => {
    expect(arg('allowGET')).toHaveLength(1);
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'CONNECT', 'HEAD', 'OPTIONS', 'TRACE']) expect(arg(`allow${m}`), m).toEqual([]);
  });
  it('GET pustí přesně cesty, které hlídač volá', () => {
    const src = readFileSync(join(KOREN, 'services/svc-accel-vstup/src/hlidac.ts'), 'utf8');
    // Hlídač volá BEZ verze v cestě (démon odpoví svou aktuální verzí API; pevná verze by po upgradu
    // Dockeru padala). Proxy pustí obojí, verzi v cestě volitelně.
    expect(src).not.toMatch(/\/v1\.[0-9]+/);
    expect(src).toMatch(/path: `\/events\?filters=/);
    const cesty = ['/containers/json', `/containers/${'a'.repeat(64)}/json`, '/containers/testfork-model-mesh-agent/json', '/networks/testfork-lane', '/networks/uzel-accel-jadro', '/events', '/info'];
    for (const p of [...cesty, ...cesty.map((c) => `/v1.44${c}`)]) expect(reGet.test(p), p).toBe(true);
  });
  it('GET nepustí nic jiného (exec, logy, archivy, export, tajemství, obrazy)', () => {
    const zakazane = ['/containers/x/logs', '/containers/x/archive', '/containers/x/export', '/exec/x/json', '/secrets', '/images/json', '/containers/x/json/../logs', '/networks', '/volumes', '/v1/containers/json', '/v1.x/containers/json', 'containers/json'];
    for (const p of [...zakazane, ...zakazane.filter((z) => z.startsWith('/') && !z.startsWith('/v1')).map((z) => `/v1.44${z}`)]) expect(reGet.test(p), p).toBe(false);
  });
  it('obraz proxy je pin z jediného domova pinů s digestem', () => {
    expect(proxy.image).toBe('${IMAGE_DOCKER_SOCKET_PROXY:?pin proxy socketu (config/image-versions.env)}');
    expect(readFileSync(join(KOREN, 'config/image-versions.env'), 'utf8')).toMatch(/^IMAGE_DOCKER_SOCKET_PROXY=\$\{REGISTRY_PROXY\}wollomatic\/socket-proxy@sha256:[0-9a-f]{64}$/m);
  });
});
