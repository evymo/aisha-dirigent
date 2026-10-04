/**
 * SBOM coverage gate — OWASP A06 + A08 defense-in-depth
 *
 * Validates that the dependency-security CI workflow generates a CycloneDX
 * SBOM for every production service, AND that the container-signing
 * workflow attaches the SBOM as a cosign attestation when building the
 * image. Either link breaking would silently drop SBOM coverage for a
 * service — the image would still be signed, but without the bill of
 * materials that lets downstream consumers verify what's inside.
 *
 * This complements (does NOT replace) the existing build-time SBOM
 * generation in `.github/workflows/dependency-security.yml` — it just
 * makes sure the workflow stays wired and that no new service ships
 * without SBOM coverage.
 *
 * Why static, not runtime:
 *   - Runtime probing the registry for signed SBOM attestations would
 *     require pulling images at PR time → slow and non-deterministic.
 *   - The workflow-yaml itself IS the spec. If a step is deleted, every
 *     subsequent build silently drops the SBOM. A static integrity gate
 *     catches the regression in the PR that removes the step.
 *
 * Exemptions: list a service in EXEMPT_SERVICES with a justification.
 * Exemption ≠ workaround — exemption is for services that genuinely
 * don't produce an image (e.g. type-only packages, experimental
 * services on no-deploy track). The list is reviewed in PR.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isTrackedService } from './lib/tracked-services';
import { duvodVynechanoSnapshotem } from './lib/vynechano-snapshotem';

const ROOT = process.cwd();
// CI/CD runs on Forgejo (self-hosted); the GitHub mirror is cost-only. The
// dependency-security workflow (npm-audit + SBOM + Trivy) was relocated from
// .github/ to .forgejo/ (2026-05-30) — the sbom job + matrix are preserved
// verbatim, so per-service SBOM coverage is still enforced here. container-signing
// is release/tag-time (cosign attestation) and stays on the GitHub side (manual).
const DEP_SEC_WORKFLOW = resolve(ROOT, '.forgejo/workflows/supply-chain.yml');
const CONTAINER_SIGN_WORKFLOW = resolve(ROOT, '.github/workflows/container-signing.yml');
// Veřejný snapshot podpisový workflow nevozí (config/public-snapshot.exclude) —
// tam se testy nad ním PŘESKOČÍ s důvodem; v upstreamu měří. Viz lib/vynechano-snapshotem.
const DUVOD_PODPIS = duvodVynechanoSnapshotem('.github/workflows/container-signing.yml');
const nezmereno = (nazev: string): string => (DUVOD_PODPIS ? `${nazev} — NEZMĚŘENO: ${DUVOD_PODPIS}` : nazev);

/**
 * Services that legitimately don't produce a deployable container image
 * and therefore don't need SBOM matrix entry. Each must have a documented
 * reason — the reason field is consulted in PR review.
 */
const EXEMPT_SERVICES: Record<string, string> = {
  'svc-aitg-probes':
    'AITG probe service is invoked from n8n workflows in staging/CI only; ' +
    'does not produce a deployable production container image and has no ' +
    'Dockerfile. The probe surface is exercised by WF_AITG_* workflows directly.',
  'svc-playwright-runner':
    'Playwright runner image is rebuilt on every release from the upstream ' +
    'mcr.microsoft.com/playwright:vX.Y.Z-jammy base, so its SBOM is derived ' +
    'from Microsoft\'s pinned image (cosign-verifiable). The npm surface is ' +
    'just @playwright/test pinned to match the base image — SBOM coverage ' +
    'lives in the parent base image, not in our matrix.',
};

/**
 * Collect the `matrix.target` bullet list for a given job in a workflow file.
 * `jobHeader` anchors on the exact job line (e.g. '\n  sbom:\n' vs
 * '\n  sbom-python:\n') so overlapping names never collide. Stops at the first
 * non-bullet, non-blank, non-comment line (end of the array).
 */
function collectMatrixTargets(content: string, jobHeader: string): string[] {
  const idx = content.indexOf(jobHeader);
  if (idx === -1) return [];
  const block = content.slice(idx + jobHeader.length);
  const targetIdx = block.indexOf('target:');
  if (targetIdx === -1) return [];
  const out: string[] = [];
  for (const line of block.slice(targetIdx).split('\n').slice(1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s+-\s+([a-z][\w-]*)\s*$/);
    if (m) out.push(m[1]);
    else break;
  }
  return out;
}

describe('SBOM coverage gate — OWASP A06 + A08', () => {
  test('dependency-security workflow exists', () => {
    expect(existsSync(DEP_SEC_WORKFLOW)).toBe(true);
  });

  test('dependency-security workflow has SBOM job using CycloneDX', () => {
    const content = readFileSync(DEP_SEC_WORKFLOW, 'utf8');
    // Job name must be "sbom"
    expect(content).toMatch(/^\s*sbom:\s*$/m);
    // Must use cyclonedx-npm with JSON spec 1.5
    expect(content).toMatch(/@cyclonedx\/cyclonedx-npm/);
    expect(content).toMatch(/--output-format\s+JSON/i);
    expect(content).toMatch(/--spec-version\s+1\.5/);
    // Must upload artifact with sane retention
    expect(content).toMatch(/upload-artifact/);
    expect(content).toMatch(/retention-days:\s*([1-9]\d{1,2}|\d{4,})/);
  });

  test.skipIf(DUVOD_PODPIS !== null)(nezmereno('container-signing workflow attaches SBOM as cosign attestation'), () => {
    expect(existsSync(CONTAINER_SIGN_WORKFLOW)).toBe(true);
    const content = readFileSync(CONTAINER_SIGN_WORKFLOW, 'utf8');
    // Must reference cyclonedx attestation type
    expect(content).toMatch(/cosign attest/);
    expect(content).toMatch(/--type\s+cyclonedx/);
    // Must consume the sbom artifact from the prior job
    expect(content).toMatch(/sbom-/);
  });

  test('every production service has SBOM matrix coverage', () => {
    const content = readFileSync(DEP_SEC_WORKFLOW, 'utf8');

    // The SBOM job uses `matrix.target: [- name, - name, ...]`. Carve out
    // the array by finding the `target:` line under the sbom job and
    // collecting subsequent `- name` lines until the indent drops or a
    // non-bullet directive appears. Anchor on the SBOM job to avoid
    // picking up other matrix.target arrays (npm-audit-services has one).
    const sbomIdx = content.indexOf('\n  sbom:\n');
    expect(sbomIdx, 'workflow must declare a job named "sbom"').toBeGreaterThan(-1);
    const sbomBlock = content.slice(sbomIdx);

    // Find first `target:` inside this block (within the matrix:)
    const targetIdx = sbomBlock.indexOf('target:');
    expect(targetIdx, 'sbom job must declare matrix.target').toBeGreaterThan(-1);
    const afterTarget = sbomBlock.slice(targetIdx);

    // Collect bullets until first non-bullet, non-blank, non-comment line
    const targets: string[] = [];
    const lines = afterTarget.split('\n').slice(1); // skip the `target:` line itself
    for (const line of lines) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const bullet = line.match(/^\s+-\s+([a-z][\w-]*)\s*$/);
      if (bullet) {
        targets.push(bullet[1]);
        continue;
      }
      // Non-bullet line: end of matrix.target array
      break;
    }
    const realTargets = targets.filter((name) => name !== 'root');

    // Walk services/ dir for actual service names
    const servicesDir = resolve(ROOT, 'services');
    const actualServices = readdirSync(servicesDir).filter((name) => {
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(name)) return false;
      const fullPath = join(servicesDir, name);
      if (!statSync(fullPath).isDirectory()) return false;
      const pkgJson = join(fullPath, 'package.json');
      return existsSync(pkgJson);
    });

    const missing = actualServices.filter(
      (s) => !realTargets.includes(s) && !(s in EXEMPT_SERVICES),
    );

    expect(missing).toEqual([]);
  });

  test('SBOM lane runs nightly on schedule + on-demand dispatch', () => {
    // REWRITTEN 2026-07-14 (owner decision): the heavy supply-chain lane
    // (SBOM ~35-target matrix, trivy, npm-audit) must NOT ride the push/PR
    // fast lane on the shared runner — it runs at full load nightly (cron)
    // plus on-demand. The previous assertion ("runs on every PR") was
    // VACUOUS: it matched ci.yml's top-level pull_request trigger while the
    // sbom job itself was dispatch-gated and never actually ran on a PR.
    // This form is honest: the workflow must have a real cron schedule and
    // a manual dispatch trigger.
    const content = readFileSync(DEP_SEC_WORKFLOW, 'utf8');
    expect(content).toMatch(/^\s*schedule:\s*$/m);
    expect(content).toMatch(/^\s*-\s*cron:\s*["'][^"']+["']\s*$/m);
    expect(content).toMatch(/^\s*workflow_dispatch:/m);
  });

  test.skipIf(DUVOD_PODPIS !== null)(nezmereno('container-signing matrix ⊆ SBOM matrix (every signed image has SBOM)'), () => {
    // SBOM matrix = the union of BOTH SBOM lanes:
    //   • `sbom`        — cyclonedx-npm over services/<name>/package-lock.json
    //   • `sbom-python` — anchore/syft over the built root Dockerfile.<name>
    //                     image (packages/* Python submodules: svc-local-ingest,
    //                     svc-potok — no npm lockfile, so structurally outside
    //                     the npm lane).
    // A signed image is covered if EITHER lane produces its SBOM artifact.
    const depSecContent = readFileSync(DEP_SEC_WORKFLOW, 'utf8');
    const sbomTargets = [
      ...collectMatrixTargets(depSecContent, '\n  sbom:\n'),
      ...collectMatrixTargets(depSecContent, '\n  sbom-python:\n'),
    ];

    // Container-signing matrix
    const signContent = readFileSync(CONTAINER_SIGN_WORKFLOW, 'utf8');
    const serviceIdx = signContent.indexOf('matrix:');
    expect(serviceIdx).toBeGreaterThan(-1);
    const afterMatrix = signContent.slice(serviceIdx);
    const serviceListAfter = afterMatrix.slice(afterMatrix.indexOf('service:'));
    const signServices: string[] = [];
    for (const line of serviceListAfter.split('\n').slice(1)) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const m = line.match(/^\s+-\s+([a-z][\w-]*)\s*$/);
      if (m) signServices.push(m[1]);
      else break;
    }

    // Every signed service MUST have SBOM (the inverse — SBOM without
    // signing — is allowed because SBOM can cover type-only packages or
    // root workspace, which legitimately don't ship as containers).
    const signedWithoutSbom = signServices.filter((s) => !sbomTargets.includes(s));
    expect(
      signedWithoutSbom,
      `Services signed by container-signing.yml but missing from SBOM matrix: ${signedWithoutSbom.join(', ')}. ` +
        'This means cosign signs the image but no SBOM attestation is generated — supply chain visibility broken.',
    ).toEqual([]);
  });

  test.skipIf(DUVOD_PODPIS !== null)(nezmereno('Python images (svc-local-ingest, svc-potok) are covered by the sbom-python lane'), () => {
    // The two packages/* Python submodule services have no npm lockfile, so the
    // cyclonedx-npm `sbom` job cannot cover them. A dedicated `sbom-python` job
    // runs anchore/syft over the built image instead. This gate makes sure the
    // lane stays wired and keeps covering both services (dropping either =
    // silent SBOM loss for a signed image).
    const content = readFileSync(DEP_SEC_WORKFLOW, 'utf8');

    // Job must exist and use a pinned syft producing CycloneDX JSON.
    expect(content).toMatch(/^\s*sbom-python:\s*$/m);
    expect(content).toMatch(/anchore\/syft/);
    expect(content).toMatch(/SYFT_VERSION=v\d+\.\d+\.\d+/);
    expect(content).toMatch(/cyclonedx-json=sbom-/);
    // Same artifact + retention shape as the npm sbom lane so consumers treat
    // both uniformly (and container-signing can download the artifact).
    expect(content).toMatch(/upload-artifact/);
    expect(content).toMatch(/retention-days:\s*([1-9]\d{1,2}|\d{4,})/);

    // Both Python services must be in the sbom-python matrix.
    const pythonTargets = collectMatrixTargets(content, '\n  sbom-python:\n');
    for (const svc of ['svc-local-ingest', 'svc-potok']) {
      expect(
        pythonTargets,
        `${svc} missing from sbom-python matrix.target — its image would ship without an SBOM`,
      ).toContain(svc);
    }

    // And both must be signed (so the CycloneDX SBOM is attached as a cosign
    // attestation — the whole point of covering them).
    const signContent = readFileSync(CONTAINER_SIGN_WORKFLOW, 'utf8');
    const serviceListAfter = signContent
      .slice(signContent.indexOf('matrix:'))
      .slice(signContent.slice(signContent.indexOf('matrix:')).indexOf('service:'));
    const signServices: string[] = [];
    for (const line of serviceListAfter.split('\n').slice(1)) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const m = line.match(/^\s+-\s+([a-z][\w-]*)\s*$/);
      if (m) signServices.push(m[1]);
      else break;
    }
    for (const svc of ['svc-local-ingest', 'svc-potok']) {
      expect(
        signServices,
        `${svc} missing from container-signing matrix.service — SBOM generated but never attached`,
      ).toContain(svc);
    }
  });

  test('exemption list has documented rationale for every entry', () => {
    for (const [service, reason] of Object.entries(EXEMPT_SERVICES)) {
      expect(reason.length).toBeGreaterThan(20);
      // Rationale must reference WHY this service is exempt — a one-word
      // justification ("experimental") isn't enough.
      expect(reason).toMatch(/\b(no|not|doesn'?t|never|n\/a)\b/i);
      // The service must actually exist in services/ — stale exemptions
      // are dead weight.
      const fullPath = resolve(ROOT, 'services', service);
      expect(existsSync(fullPath), `Exemption for ${service} but services/${service} doesn't exist`).toBe(true);
    }
  });
});
