/**
 * Gate: NetBird mesh endpoint (host + port) is per-instance, never hardcoded.
 *
 * Multiple independent AISHA instances can share ONE physical host. Their NetBird
 * control-plane endpoint (advertised to agents + published on the host) must be
 * DERIVED from the instance namespace (APP_NAME_PREFIX) so two co-located instances
 * never bind the same host port or point agents at a "foreign" instance's stack.
 *
 * Isolation primitives (this gate locks the host/port half — the load-bearing
 * host-level collision fix):
 *   - `NETBIRD_MESH_PORT` — host port, derived per-instance in aisha-cold-start.sh
 *     (primary `aisha` = 33073; any other namespace = a deterministic unique port).
 *   - `NETBIRD_MESH_HOST` — per-instance hostname, likewise derived.
 *
 * Enforced:
 *   1. No host-facing `${NETBIRD_MESH_HOST}:33073` literal survives — every mesh
 *      URL uses `${NETBIRD_MESH_PORT}` so a namespaced instance moves off 33073.
 *   2. netbird-internal-tls publishes the host port via `${NETBIRD_MESH_PORT...}`.
 *   3. cold-start derives NETBIRD_MESH_PORT from the namespace (not a fixed literal).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');

const MESH_URL_FILES = [
  'docker-compose.coolify.yml',
  'docker-compose.coolify-integration.yml',
  'docker-compose.coolify-cosmos.yml',
  'docker-compose.coolify-prebuilt.yml',
  'coolify/netbird-management.json.template',
];

describe('NetBird mesh endpoint is per-instance (host + port derived, never hardcoded)', () => {
  it('no host-facing `${NETBIRD_MESH_HOST}:33073` literal remains (all use ${NETBIRD_MESH_PORT})', () => {
    const offenders: string[] = [];
    for (const f of MESH_URL_FILES) {
      const t = read(f);
      t.split('\n').forEach((ln, i) => {
        if (/\$\{NETBIRD_MESH_HOST\}:33073\b/.test(ln)) offenders.push(`${f}:${i + 1}  ${ln.trim()}`);
      });
    }
    expect(
      offenders,
      `mesh URLs must use \${NETBIRD_MESH_PORT} so a co-located namespaced instance leaves 33073:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every agent NB_MANAGEMENT_URL uses the dynamic mesh port', () => {
    for (const f of ['docker-compose.coolify.yml', 'docker-compose.coolify-integration.yml', 'docker-compose.coolify-cosmos.yml']) {
      const t = read(f);
      const m = t.match(/NB_MANAGEMENT_URL:\s*\S+/);
      expect(m, `${f}: NB_MANAGEMENT_URL not found`).toBeTruthy();
      expect(m![0], `${f}: NB_MANAGEMENT_URL must reference \${NETBIRD_MESH_PORT}`).toMatch(/\$\{NETBIRD_MESH_PORT/);
    }
  });

  it('netbird-init passes NETBIRD_MESH_PORT env so the Signal template never renders an empty port', () => {
    // The template renders `${NETBIRD_MESH_HOST}:${NETBIRD_MESH_PORT}` via envsubst,
    // which has NO `:-` fallback — if netbird-init does not export the var the port
    // renders empty and every agent's Signal URI breaks.
    const t = read('docker-compose.coolify-netbird.yml');
    expect(t, 'netbird-init must inject NETBIRD_MESH_PORT for the management.json envsubst').toMatch(
      /netbird-init:[\s\S]*?environment:[\s\S]*?NETBIRD_MESH_PORT:\s*\$\{NETBIRD_MESH_PORT:-33073\}/,
    );
  });

  it('netbird-internal-tls publishes the host port via ${NETBIRD_MESH_PORT}', () => {
    const t = read('docker-compose.coolify-netbird.yml');
    expect(t, 'host publish must be `${NETBIRD_MESH_PORT:-33073}:33073` (dynamic host, fixed container)').toMatch(
      /-\s*"\$\{NETBIRD_MESH_PORT:-33073\}:33073"/,
    );
  });

  it('management.json.template advertises Signal + Relay on the dynamic mesh port', () => {
    const t = read('coolify/netbird-management.json.template');
    expect(t, 'Signal URI must use ${NETBIRD_MESH_PORT}').toMatch(/"URI":\s*"\$\{NETBIRD_MESH_HOST\}:\$\{NETBIRD_MESH_PORT\}"/);
    expect(t, 'Relay must use ${NETBIRD_MESH_PORT}').toMatch(/rels:\/\/\$\{NETBIRD_MESH_HOST\}:\$\{NETBIRD_MESH_PORT\}\/relay/);
  });

  it('cold-start DERIVES NETBIRD_MESH_PORT from the instance namespace (not a fixed literal)', () => {
    const t = read('scripts/aisha-cold-start.sh');
    // primary aisha keeps 33073; other namespaces get a computed unique port.
    // Vlastnost: NS se ODVOZUJE z identity instance. NE pravopis — do 2026-08-04
    // se tu vyžadoval doslova `${APP_NAME_PREFIX:-aisha}`, tedy ten fail-open
    // tvar, který z nedeklarované instance dělá upstream. Brána
    // instance-identity-fail-closed ho dnes zakazuje, takže pinovat ho tady by
    // znamenalo, že si dvě brány přímo protiřečí.
    expect(t).toMatch(/NETBIRD_NS="\$\{NETBIRD_NS:-\$\{APP_NAME_PREFIX[^}]*\}\}"/);
    expect(t).toMatch(/NETBIRD_MESH_PORT="\$\{NETBIRD_MESH_PORT:-33073\}"/); // aisha branch
    expect(t, 'non-primary namespace must derive a unique port (cksum offset)').toMatch(
      /NETBIRD_MESH_PORT="\$\{NETBIRD_MESH_PORT:-\$\(\(33073 \+ _nb_mesh_off\)\)\}"/,
    );
    expect(t, 'derivation must be namespace-driven (cksum of NETBIRD_NS)').toMatch(/printf '%s' "\$NETBIRD_NS" \| cksum/);
  });
});
