/**
 * Gate: the two root fixes for the "aisha-core silently vanishes" incident (2026-07-06).
 *
 * Root chain: pki config-init ran a BARE `envsubst < file` over the whole OpenXPKI
 * config tree. Without a shell-format arg, envsubst substitutes EVERY `$VAR` — which
 * emptied OpenXPKI's own connector shorthand `_map_x: $context_key` (e.g.
 * is_valid_key.yaml's `$cert_profile` / `$csr_key_params` / `$csr_key_alg`), because
 * those aren't env vars. The KeyParams condition then got undef params and threw, so
 * `certificate_enroll` died at PROFILE_SET ("no actions available") → no mesh TLS cert
 * → netbird-agent crash-looped on TLS → Coolify's restart-limit
 * (GetContainersStatus → StopApplication) killed the WHOLE aisha-core app.
 *
 * Fix 1 (root): scope the pki envsubst to the 3 domain vars.
 * Fix 2 (hardening): netbird-agent retries `netbird up` instead of `exec`-ing it, so a
 *   mesh/PKI outage can never make the container die → RestartCount stays 0 → Coolify
 *   never stops the app. A sidecar outage must not down the stack.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const pki = fs.readFileSync(path.join(ROOT, 'docker-compose.coolify-pki.yml'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'docker-compose.coolify.yml'), 'utf8');

// The three mesh-peer stacks that each run a pki-init + a netbird-agent sidecar.
// aisha-core / aisha-integration / ledger(cosmos) all join the mesh over AISHA PKI TLS.
const MESH_STACKS: Array<{ name: string; file: string; text: string }> = [
  { name: 'core', file: 'docker-compose.coolify.yml', text: core },
  {
    name: 'integration',
    file: 'docker-compose.coolify-integration.yml',
    text: fs.readFileSync(path.join(ROOT, 'docker-compose.coolify-integration.yml'), 'utf8'),
  },
  {
    name: 'ledger',
    file: 'docker-compose.coolify-cosmos.yml',
    text: fs.readFileSync(path.join(ROOT, 'docker-compose.coolify-cosmos.yml'), 'utf8'),
  },
];

// Shared CA-bundle assembler, baked into Dockerfile.pki-init and called by every
// stack's pki-init. Extracting it (vs an inline compose command) keeps each compose
// under Coolify's ARG_MAX byte budget AND removes the 3× duplication.
const assembleScript = fs.readFileSync(path.join(ROOT, 'infra/pki/assemble-ca-bundle.sh'), 'utf8');
const pkiInitDockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile.pki-init'), 'utf8');

describe('pki config-init envsubst must be scoped (never clobbers OpenXPKI $shorthand)', () => {
  it('does NOT run a bare `envsubst < "$$f"` over the config tree', () => {
    // A bare envsubst (no shell-format arg) substitutes every $VAR and empties the
    // OpenXPKI `_map_x: $cert_profile` shortcuts → certificate_enroll dies at PROFILE_SET.
    expect(
      /envsubst\s*<\s*"\$\$f"/.test(pki),
      'bare `envsubst < "$$f"` clobbers OpenXPKI $context shorthand ($cert_profile/$csr_key_params/$csr_key_alg) to empty — scope it with a shell-format arg',
    ).toBe(false);
  });

  it('scopes the config-tree envsubst to the intended domain vars only', () => {
    // Must name the vars so only ${PKI_DOMAIN}/${INTERNAL_TLD}/${MESH_TLD} are touched.
    expect(pki).toMatch(/envsubst\s+'[^']*\$\$\{PKI_DOMAIN\}[^']*'\s*<\s*"\$\$f"/);
    expect(pki).toMatch(/envsubst\s+'[^']*\$\$\{INTERNAL_TLD\}[^']*'\s*<\s*"\$\$f"/);
    expect(pki).toMatch(/envsubst\s+'[^']*\$\$\{MESH_TLD\}[^']*'\s*<\s*"\$\$f"/);
  });
});

describe('netbird-agent must not crash-loop the whole aisha-core stack', () => {
  it('does NOT `exec netbird up` (exec → die → restart → Coolify restart-limit kills core)', () => {
    expect(
      /exec\s+netbird\s+up/.test(core),
      '`exec netbird up` makes a mesh/TLS outage kill the container → RestartCount climbs → Coolify StopApplication kills aisha-core. Use a retry loop that keeps the container alive.',
    ).toBe(false);
  });

  it('retries `netbird up` in a loop so a mesh outage keeps RestartCount=0', () => {
    // the looped invocation passes the pre-built positional args
    expect(core).toMatch(/while\s*:\s*;\s*do[\s\S]{0,200}netbird up "\$\$@"/);
  });
});

/**
 * Fix 3 (mesh trust, cold-start-safe): a committed static CA bundle can NEVER match the
 * CA the pki-realm actually generates at runtime (random EC keypair, persisted in the
 * pki-keys volume). So every mesh peer's pki-init must fetch the LIVE bundle from the
 * pki-bridge (/diag/ca-bundle) — referencing ${PKI_BRIDGE_URL} makes coolify-sync-envs
 * push the URL — and fall back to the baked bundle only when the bridge is unreachable.
 * netbird (a Go binary) trusts the bundle via SSL_CERT_FILE, so that must point at the
 * fetched bundle too, not just NB_SSL_TRUST_BUNDLE.
 */
/**
 * 2026-07-19 — this block used to REQUIRE the baked-bundle fallback:
 *
 *   expect(assembleScript, 'assembler must fall back to the baked /staging
 *     bundle on the first cold-start wave').toMatch(/staging/)
 *
 * That assertion pinned the defect in place. The realm CAs are minted at first
 * boot by pki-realm-bootstrap.sh from a random EC keypair, while the baked
 * config/pki/aisha-ca-bundle.pem froze on 2026-04-13 — so the fallback could
 * never produce a trust anchor matching the CA that signs mesh TLS. Taking it
 * left every container reporting healthy while netbird failed with
 * `x509: ECDSA verification failure` and api/mcp answered 502.
 *
 * Note the shape of the old check: `toMatch(/staging/)` is a SPELLING test. It
 * would have passed just as happily if the fallback were subtly broken, and it
 * failed only when the behaviour was CORRECTED. Runtime behaviour is now owned
 * by src/tests/gates/pki-bundle-fail-closed.gate.test.ts, which executes the
 * script against a fake pki-bridge instead of reading it.
 *
 * What stays here: the wiring facts this file is about — the assembler talks to
 * the bridge, and Dockerfile.pki-init bakes it so every mesh stack shares one
 * implementation.
 */
describe('the shared CA-bundle assembler fetches the LIVE realm CA (or fails closed)', () => {
  it('assemble-ca-bundle.sh fetches from the pki-bridge /diag/ca-bundle', () => {
    expect(assembleScript, 'assembler must fetch the live realm CA from the pki-bridge').toMatch(/\/diag\/ca-bundle/);
    expect(assembleScript, 'assembler must consult ${PKI_BRIDGE_URL}').toMatch(/PKI_BRIDGE_URL/);
  });

  it('assemble-ca-bundle.sh does NOT fall back to the baked bundle', () => {
    const executable = assembleScript
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(
      executable,
      'the baked /staging bundle cannot match a runtime-minted realm CA — appending it ' +
        'yields healthy containers with dead mesh TLS. See pki-bundle-fail-closed.gate.test.ts.',
    ).not.toMatch(/\/staging\/aisha-ca-bundle/);
  });

  it('Dockerfile.pki-init bakes the assembler so all 3 mesh stacks share one impl', () => {
    expect(pkiInitDockerfile).toMatch(/COPY\s+infra\/pki\/assemble-ca-bundle\.sh\s+\/usr\/local\/bin\/assemble-ca-bundle\.sh/);
  });
});

describe('every mesh peer fetches the LIVE CA bundle and trusts it via SSL_CERT_FILE', () => {
  for (const s of MESH_STACKS) {
    it(`${s.name}: pki-init calls the shared assembler and references $\{PKI_BRIDGE_URL}`, () => {
      // Referencing the var makes coolify-sync-envs push it (cold-start-safe, no hardcoded URL).
      expect(s.text, `${s.file}: pki-init must reference $\{PKI_BRIDGE_URL} so coolify-sync-envs pushes it`).toMatch(
        /PKI_BRIDGE_URL/,
      );
      // The verbose inline fetch was extracted to the baked assembler (ARG_MAX + DRY).
      expect(s.text, `${s.file}: pki-init must call the baked /usr/local/bin/assemble-ca-bundle.sh`).toMatch(
        /assemble-ca-bundle\.sh/,
      );
    });

    it(`${s.name}: netbird-agent trusts the fetched bundle via SSL_CERT_FILE`, () => {
      expect(
        s.text,
        `${s.file}: netbird (Go) reads SSL_CERT_FILE for its trust store — must point at /certs/pki/aisha-ca-bundle.pem`,
      ).toMatch(/SSL_CERT_FILE:\s*\/certs\/pki\/aisha-ca-bundle\.pem/);
    });

    it(`${s.name}: netbird-agent never \`exec netbird up\` (would crash-loop → Coolify stops the app)`, () => {
      expect(
        /exec\s+netbird\s+up/.test(s.text),
        `${s.file}: \`exec netbird up\` makes a mesh/TLS outage kill the sidecar → RestartCount climbs → Coolify StopApplication stops the whole tenant stack. Use the retry loop.`,
      ).toBe(false);
    });

    it(`${s.name}: retries \`netbird up\` in a loop (keeps RestartCount=0 through a mesh outage)`, () => {
      expect(s.text).toMatch(/while\s*:\s*;\s*do[\s\S]{0,200}netbird up "\$\$@"/);
    });
  }
});
