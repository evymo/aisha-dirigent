/**
 * Gate test: Phase 12 WP 3.8 — Supply chain hardening invariants.
 *
 * Enforces:
 *   1. dependency-security.yml has trivy-scan job with CRITICAL+HIGH gating
 *   2. trivy-scan exit-code is 1 (fails build on findings)
 *   3. SARIF results uploaded to GitHub Security tab
 *   4. SBOM job has MinIO mirror step (with skip-on-missing-secret guard)
 *   5. .trivyignore exists with documented format
 *   6. docker-compose.coolify.yml bootstraps aisha-sbom-artifacts bucket
 *      (deklarace STORAGE_BUCKETS pro storage-init, čtená přes lib/storage-init)
 *   7. SBOM bucket is NOT anonymous-readable (internal-only)
 *   8. Runbook documents operator wiring + forensic queries
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { storageInit } from './lib/storage-init';

const ROOT = process.cwd();
const WORKFLOW = path.join(
  ROOT,
  // Relocated to Forgejo (2026-05-30): CI/CD runs on self-hosted infra; the
  // GitHub mirror is cost-only. SBOM + MinIO-mirror content preserved verbatim.
  '.forgejo/workflows/supply-chain.yml',
);
const IMAGE_VERSIONS = path.join(ROOT, 'config/image-versions.env');
const TRIVYIGNORE = path.join(ROOT, '.trivyignore');
const RUNBOOK = path.join(ROOT, 'docs/security/SUPPLY_CHAIN_RUNBOOK.md');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 3.8 — Trivy CVE scan job', () => {
  const yaml = readOrEmpty(WORKFLOW);

  it('dependency-security.yml exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  it('declares a `trivy-scan` job', () => {
    expect(yaml).toMatch(/^\s{2}trivy-scan:/m);
  });

  it('uses trivy (aquasecurity/trivy-action OR aquasec/trivy docker image)', () => {
    // On Forgejo the act_runner can't resolve the action's git tag, so trivy
    // runs via `docker run aquasec/trivy:<ver>` instead. Either form satisfies
    // the spec (a pinned trivy scanner is invoked).
    expect(yaml).toMatch(/aquasecurity\/trivy-action@|aquasec\/trivy:\d/);
  });

  it('severity is CRITICAL,HIGH (not LOW/MEDIUM noise)', () => {
    // Matches the action input (`severity: CRITICAL,HIGH`) and CLI (`--severity CRITICAL,HIGH`).
    expect(yaml).toMatch(/severity[:\s=]+CRITICAL,HIGH/);
  });

  it('exit-code is "1" (FAILS build on CVE finding)', () => {
    // Action input `exit-code: '1'` OR CLI flag `--exit-code 1`.
    expect(yaml).toMatch(/exit-code['":\s=]+1\b/);
  });

  it('ignore-unfixed is set (no fail on unpatchable CVEs)', () => {
    // Action input `ignore-unfixed: true` OR CLI flag `--ignore-unfixed`.
    expect(yaml).toMatch(/ignore-unfixed/);
  });

  it('reads .trivyignore allowlist', () => {
    // Action input `trivyignores: .trivyignore` OR CLI flag `--ignorefile .trivyignore`.
    expect(yaml).toMatch(/trivyignores:\s*\.trivyignore|--ignorefile\s+\.trivyignore/);
  });

  it('generates + preserves Trivy SARIF (Security-tab on GitHub, artifact on Forgejo)', () => {
    // SARIF must actually be produced (machine-readable supply-chain evidence)...
    expect(yaml).toMatch(/format[:\s=]+sarif/);
    expect(yaml).toMatch(/trivy-[^\s"']*\.sarif/);
    // ...and preserved. On GitHub that's the Security tab (codeql upload-sarif +
    // security-events: write); on self-hosted Forgejo (no Security tab) the SARIF
    // is retained as a CI artifact instead. Either mechanism satisfies the intent
    // (the scan result is captured, not discarded).
    expect(yaml).toMatch(/codeql-action\/upload-sarif|upload-artifact/);
  });

  it('matrix scans every deployable service (>= 18 targets)', () => {
    const m = yaml.match(/trivy-scan:[\s\S]*?target:\s*\n([\s\S]*?)\n\s{4}env:/);
    expect(m, 'trivy-scan matrix.target block not found').not.toBeNull();
    const targets = (m?.[1] ?? '').match(/^\s+-\s+\S+$/gm) ?? [];
    expect(targets.length, `expected >= 18 services, found ${targets.length}`).toBeGreaterThanOrEqual(18);
  });
});

describe('Phase 12 WP 3.8 — SBOM MinIO mirror', () => {
  const yaml = readOrEmpty(WORKFLOW);

  it('sbom job has Mirror SBOM to MinIO step', () => {
    expect(yaml).toMatch(/Mirror SBOM to MinIO/);
  });

  it('skips gracefully when AISHA_MINIO_S3_PUBLIC_ENDPOINT secret unset', () => {
    expect(yaml).toMatch(/if:\s*\$\{\{\s*env\.MINIO_PUBLIC_ENDPOINT\s*!=\s*''\s*\}\}/);
  });

  it('mirrors with an image that still exists, pinned in the single source of truth', () => {
    // Do 2026-09-12 tu stálo `minio/mc:latest`, pak `quay.io/minio/mc:RELEASE…`.
    // Obě cesty umřely: Docker Hub `minio/*` smazán 2026-09-11, quay.io/minio od
    // 2026-09-24 vrací 401. Měří se proto VLASTNOST — obraz se bere z pinu
    // v config/image-versions.env (ne literál v workflow, který by se rozešel)
    // a ten pin je připnutý tag — ne konkrétní pravopis.
    const mirror = yaml.split('\n').filter((r) => !r.trim().startsWith('#')).join('\n');
    const cteni = [...mirror.matchAll(/sed -n 's\/\^(IMAGE_[A-Z0-9_]+)=/g)].map((m) => m[1]);
    expect(cteni.length, 'oba SBOM kroky (npm i python) čtou pin ze SoT').toBeGreaterThanOrEqual(2);
    expect(new Set(cteni)).toEqual(new Set(['IMAGE_RCLONE']));
    const pin = readOrEmpty(IMAGE_VERSIONS).match(/^IMAGE_RCLONE=(.+)$/m)?.[1]?.trim() ?? '';
    expect(pin, 'IMAGE_RCLONE musí být připnutý tag').toMatch(/^\$\{REGISTRY_PROXY\}rclone\/rclone:\d+\.\d+/);
    expect(mirror, 'MinIO obraz z registru se do workflow vrátil').not.toMatch(/minio\/mc[:\s]|quay\.io\/minio\//);
  });

  it('uploads to aisha-sbom-artifacts bucket with content-addressable path', () => {
    expect(yaml).toMatch(/aisha-sbom-artifacts\/\$\{SBOM_NAME\}\/\$\{COMMIT_SHA\}/);
  });

  it('uses repo secrets (no inline credentials)', () => {
    expect(yaml).toMatch(/secrets\.AISHA_MINIO_S3_PUBLIC_ENDPOINT/);
    expect(yaml).toMatch(/secrets\.AISHA_MINIO_ACCESS_KEY/);
    expect(yaml).toMatch(/secrets\.AISHA_MINIO_SECRET_KEY/);
  });
});

describe('Phase 12 WP 3.8 — Python SBOM lane (svc-local-ingest, svc-potok)', () => {
  const yaml = readOrEmpty(WORKFLOW);

  it('declares a `sbom-python` job', () => {
    expect(yaml).toMatch(/^\s{2}sbom-python:/m);
  });

  it('generates a CycloneDX SBOM via anchore/syft over the built image', () => {
    // Python submodule services have no npm lockfile, so cyclonedx-npm can't
    // cover them — syft over the built image is the SoT-faithful path (captures
    // pip + apt packages).
    expect(yaml).toMatch(/anchore\/syft/);
    expect(yaml).toMatch(/cyclonedx-json=sbom-/);
  });

  it('pins the syft version (reproducible SBOM tooling)', () => {
    expect(yaml).toMatch(/SYFT_VERSION=v\d+\.\d+\.\d+/);
  });

  it('covers both Python images and preserves the SBOM artifact', () => {
    const m = yaml.match(/sbom-python:[\s\S]*?target:\s*\n([\s\S]*?)\n\s{4}env:/);
    expect(m, 'sbom-python matrix.target block not found').not.toBeNull();
    const block = m?.[1] ?? '';
    expect(block).toMatch(/-\s+svc-local-ingest\b/);
    expect(block).toMatch(/-\s+svc-potok\b/);
    // Retention artifact, same shape as the npm sbom job.
    expect(yaml).toMatch(/name:\s*sbom-\$\{\{\s*matrix\.target\s*\}\}/);
  });

  it('fails honestly when DinD is unavailable (no skip-to-green)', () => {
    // The lane builds the image then syfts it — it cannot run without a docker
    // daemon and must not hollow-green. An explicit detect step errors + exits.
    expect(yaml).toMatch(/DinD daemon UNREACHABLE/);
  });
});

describe('Phase 12 WP 3.8 — .trivyignore allowlist', () => {
  it('.trivyignore file exists', () => {
    expect(fs.existsSync(TRIVYIGNORE)).toBe(true);
  });

  it('documents required fields per entry (WHY + WHEN + WHO)', () => {
    const src = readOrEmpty(TRIVYIGNORE);
    expect(src).toMatch(/WHY/);
    expect(src).toMatch(/WHEN/);
    expect(src).toMatch(/WHO/);
  });

  it('starts clean (zero accepted CVEs at WP launch)', () => {
    const src = readOrEmpty(TRIVYIGNORE);
    // Strip comments + blank lines
    const entries = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(entries.length, `unexpected non-empty .trivyignore entries: ${entries.join(', ')}`).toBe(0);
  });
});

describe('Phase 12 WP 3.8 — MinIO bucket bootstrap', () => {
  const uloziste = storageInit(ROOT);

  it('storage-init bootstraps aisha-sbom-artifacts bucket', () => {
    expect([...uloziste.buckety]).toContain('aisha-sbom-artifacts');
  });

  it('SBOM bucket is NOT anonymous-readable (internal-only by design)', () => {
    // Kontrolní vzorek: veřejné čtení se čte z téže deklarace a není prázdné.
    expect(uloziste.verejne.size).toBeGreaterThan(0);
    expect([...uloziste.verejne]).not.toContain('aisha-sbom-artifacts');
  });

  it('documents WP 3.8 rationale (docs, ne compose)', () => {
    // ⛔ 2026-08-23: tohle tvrzení hledalo odůvodnění v KOMENTÁŘI COMPOSE.
    // Majitel: „v compose komentáře nemají co dělat, na ty máme vlastní místo."
    // Odůvodnění se proto přesunulo do docs/architecture/CORE_COMPOSE_ROZHODNUTI.md
    // — vlastnost („je to někde napsané") platí dál, jen se měří tam, kam to patří.
    // Vedlejší účinek přesunu: compose zhubl o 4 170 B a vešel se pod ARG_MAX limit,
    // který jsem kvůli tomu málem zvedl.
    const rozhodnuti = path.join(ROOT, 'docs/architecture/CORE_COMPOSE_ROZHODNUTI.md');
    expect(fs.existsSync(rozhodnuti), 'CORE_COMPOSE_ROZHODNUTI.md chybí — odůvodnění nemá kde být').toBe(true);
    expect(fs.readFileSync(rozhodnuti, 'utf8')).toMatch(/Phase 12 WP 3\.8/);
  });
});

describe('Phase 12 WP 3.8 — runbook', () => {
  it('SUPPLY_CHAIN_RUNBOOK.md exists', () => {
    expect(fs.existsSync(RUNBOOK)).toBe(true);
  });

  it('documents Trivy behavior (severity + exit code + allowlist)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/CRITICAL.*HIGH|CRITICAL\s*\+\s*HIGH/);
    expect(md).toMatch(/exit/i);
    expect(md).toMatch(/\.trivyignore/);
  });

  it('documents operator wiring (2 deploy options + GHA secret setup)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Option A/);
    expect(md).toMatch(/Option B/);
    expect(md).toMatch(/AISHA_MINIO_ACCESS_KEY/);
  });

  it('documents forensic query patterns (mc cat / find dep version)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Forensic queries|forensic queries/i);
    expect(md).toMatch(/mc cat/);
  });

  it('documents rollback for both Trivy gate + MinIO mirror', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/[Rr]ollback/);
    expect(md).toMatch(/Disable Trivy gate/i);
    expect(md).toMatch(/Disable MinIO mirror/i);
  });

  it('references EU AI Act SBOM requirement', () => {
    expect(readOrEmpty(RUNBOOK)).toMatch(/EU AI Act/);
  });
});
