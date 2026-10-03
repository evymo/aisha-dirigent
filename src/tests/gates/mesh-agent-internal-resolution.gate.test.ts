/**
 * Gate: every NetBird mesh peer resolves the mesh control-plane host INTERNALLY.
 *
 * The mesh TLD (`*.mesh.aisha.internal`) has NO public DNS record — by design.
 * A missing resolution therefore fails loud (NXDOMAIN) instead of silently
 * resolving the mesh host to the public edge IP and NAT-hairpin timing out.
 *
 * That silent public-DNS leak was the ROOT CAUSE of the edge mesh-router
 * enrollment failure (2026-07-07): the `mesh-router` service had NO `extra_hosts`
 * and leaned on public DNS for `${NETBIRD_MESH_HOST}` → `dial tcp <public>:33073:
 * i/o timeout` → `netbird up` rc=1 → no wt0 → edge never joined the mesh, while
 * the backend/integration/cosmos agents (which DO map the host to the Frontend
 * LAN IP via extra_hosts) enrolled fine.
 *
 * Invariant locked here: any compose service that enrolls against the mesh
 * control-plane via `${NETBIRD_MESH_HOST}` MUST carry an `extra_hosts` entry that
 * maps that host to an internal target (`${NETBIRD_MGMT_HOST:-host-gateway}`) —
 * the proven backend netbird-agent pattern. Prevents the edge (or any future
 * peer) from silently regressing to the public NAT-hairpin path.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');

// Composes that run a NetBird agent / mesh-router enrolling against the mesh
// control-plane via ${NETBIRD_MESH_HOST}.
const MESH_PEER_FILES = [
  'docker-compose.coolify.yml', // aisha-core netbird-agent
  'docker-compose.coolify-integration.yml', // aisha-integration netbird-agent
  'docker-compose.coolify-cosmos.yml', // aisha-ledger/cosmos netbird-agent
  'docker-compose.coolify-prebuilt.yml', // aisha-edge mesh-router
];

describe('mesh peers resolve the mesh control-plane host internally (no public-DNS leak)', () => {
  for (const f of MESH_PEER_FILES) {
    it(`${f}: enrolls via internal mesh host backed by an extra_hosts mapping`, () => {
      const t = read(f);
      expect(t, `${f} not found`).not.toEqual('');

      // Only enforce for files that actually enroll against the mesh host.
      if (!/NB_MANAGEMENT_URL:[^\n]*\$\{NETBIRD_MESH_HOST\}/.test(t)) return;

      // The management URL must use the internal ${NETBIRD_MESH_HOST}, never the
      // public ${NETBIRD_DOMAIN} (which would route via Coolify Traefik / public
      // LE cert instead of the AISHA-PKI internal-tls endpoint).
      expect(t, `${f}: NB_MANAGEMENT_URL must target \${NETBIRD_MESH_HOST}, not the public domain`).toMatch(
        /NB_MANAGEMENT_URL:[^\n]*\$\{NETBIRD_MESH_HOST\}/,
      );

      // There MUST be an extra_hosts entry mapping ${NETBIRD_MESH_HOST} to an
      // internal target. Its absence = the exact 2026-07-07 edge regression.
      expect(
        t,
        `${f}: a NetBird peer enrolls via \${NETBIRD_MESH_HOST} but has no extra_hosts ` +
          `mapping for it → under the .internal mesh TLD it resolves via PUBLIC DNS (or NXDOMAIN) ` +
          `and NAT-hairpin times out. Add:\n` +
          `    extra_hosts:\n` +
          `      - "\${NETBIRD_MESH_HOST}:\${NETBIRD_MGMT_HOST:-host-gateway}"`,
      ).toMatch(/-\s*"\$\{NETBIRD_MESH_HOST\}:\$\{NETBIRD_MGMT_HOST/);
    });
  }
});
