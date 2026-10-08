# Supply Chain Runbook — Phase 12 WP 3.8

> Snapshot 2026-05-20. Companion to `.github/workflows/dependency-security.yml`
> + `.github/workflows/container-signing.yml` + `.trivyignore`.

## Goal

Harden AISHA's supply chain to **EU AI Act high-risk system** baseline:

1. **CVE detection** — Trivy scans every service for CRITICAL/HIGH CVEs,
   blocks merge if unfixed
2. **SBOM generation** — CycloneDX per service, uploaded to:
   - GHA artifacts (short-term, 90-day expiry) — fast access during PR review
   - **MinIO `aisha-sbom-artifacts` bucket** (unbounded retention, content-
     addressable by commit SHA) — long-term forensic + compliance archive
3. **Image signing** — cosign sign + SBOM attestation at tag-push
4. **Provenance** — SLSA L1 attestation (existing in container-signing.yml)

## What's in this PR (WP 3.8 deliverables)

- `.github/workflows/dependency-security.yml`:
  - **NEW** `trivy-scan` matrix job — 21 services scanned for CRITICAL/HIGH
    CVEs in `services/<svc>` filesystem mode (catches both npm + apk layers)
  - **NEW** `Mirror SBOM to MinIO` step in `sbom` job — uploads
    `sbom-<svc>.cdx.json` to `aisha/aisha-sbom-artifacts/<svc>/<sha>.cdx.json`
  - SARIF results uploaded to GitHub Security tab (`security-events: write`)
- `docker-compose.coolify.yml`:
  - `minio-init` extended with bucket `aisha-sbom-artifacts` (since 2026-09-25 declared
    in `STORAGE_BUCKETS`, created by `storage-init` — `docker/minio/Dockerfile`, target `mc`)
  - Bucket INTENTIONALLY NOT made anonymous-readable (supply-chain
    artifacts are internal — operator-only access via mc/console)
- `.trivyignore`:
  - Empty allowlist (zero accepted CVEs at WP launch)
  - Documented format: WHY + WHEN to re-evaluate + WHO approved
- This runbook

## Trivy behavior

- **Scan target**: `services/<svc>` filesystem (sees package.json + lockfile)
- **Severities**: CRITICAL + HIGH (MEDIUM/LOW ignored — too noisy for gate)
- **`--ignore-unfixed`**: skip CVEs without upstream patch (we can't fix them anyway)
- **Exit**: `1` on any CRITICAL/HIGH → blocks PR merge
- **Allowlist**: `.trivyignore` entries with justification comments

### When Trivy blocks your PR

1. Open the failed Trivy job → expand the matrix entry for the failing service
2. Locate the CVE ID + the dep that introduces it
3. **First try**: bump the dep to a patched version
4. **If no patch**: add CVE to `.trivyignore` with full justification +
   target re-evaluation date + approver
5. If exploitable in our usage → STOP, design a workaround at code level
   (e.g. input sanitization at API boundary). Don't allowlist real exploits.

## SBOM MinIO upload (when it runs)

The `Mirror SBOM to MinIO` step:
- Runs **only when** `AISHA_MINIO_S3_PUBLIC_ENDPOINT` secret is set
  (otherwise skipped — external PR runner without cluster access)
- Uses `rclone` (`copyto`, pin `IMAGE_RCLONE` from `config/image-versions.env`, S3 remote
  from `RCLONE_CONFIG_AISHA_*` env) to push the SBOM file. Until 2026-09-25 this was
  `minio/mc` — MinIO no longer publishes images (Docker Hub deleted, quay.io 401).
- Path: `aisha-sbom-artifacts/<service-name>/<commit-sha>.cdx.json`
- Authenticated via `AISHA_MINIO_ACCESS_KEY` + `AISHA_MINIO_SECRET_KEY` GHA secrets

### Operator wiring (one-time)

1. **Expose MinIO via secure public endpoint** — choose ONE:
   - **Option A (preferred)**: Self-hosted GitHub Actions runner in the
     cluster with mesh access. Set env: `AISHA_MINIO_S3_PUBLIC_ENDPOINT=minio:9000`.
     No public exposure of MinIO required.
   - **Option B**: Public-facing MinIO route at `minio.<your-domain>` with
     dedicated IAM service-account for CI (read-only on most buckets,
     write-only on `aisha-sbom-artifacts`). Add to Coolify
     `docker_compose_domains` for MinIO service.
2. **Create dedicated MinIO IAM service account**:
   ```
   mc admin user add aisha aisha-sbom-ci <random-strong-password>
   mc admin policy attach aisha sbom-write --user=aisha-sbom-ci
   ```
   Where `sbom-write` policy:
   ```json
   {"Version":"2012-10-17","Statement":[{
     "Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],
     "Resource":"arn:aws:s3:::aisha-sbom-artifacts/*"
   }]}
   ```
3. **Add GitHub Actions repo secrets** (the mirror step is opt-in — it is skipped while unset):
   - `AISHA_MINIO_S3_PUBLIC_ENDPOINT` — `minio.<your-domain>` or `minio:9000`
   - `AISHA_MINIO_ACCESS_KEY` — `aisha-sbom-ci`
   - `AISHA_MINIO_SECRET_KEY` — the password set above
4. **Trigger one workflow run** to confirm upload works:
   ```bash
   mc ls aisha/aisha-sbom-artifacts/
   # Expected: <service>/<commit-sha>.cdx.json entries
   ```

## Forensic queries (when you need to investigate)

### Find every SBOM for a service
```bash
mc ls aisha/aisha-sbom-artifacts/svc-ai-chat/ | head -20
```

### Inspect the SBOM of a specific deploy
```bash
mc cat aisha/aisha-sbom-artifacts/svc-ai-chat/abc123def.cdx.json | jq .
```

### Find all services using a specific dependency version
```bash
for svc in $(mc ls aisha/aisha-sbom-artifacts/ | awk '{print $5}'); do
  latest=$(mc ls "aisha/aisha-sbom-artifacts/${svc}" | tail -1 | awk '{print $5}')
  if mc cat "aisha/aisha-sbom-artifacts/${svc}${latest}" | jq -e '.components[] | select(.name=="some-dep" and .version=="1.2.3")' > /dev/null; then
    echo "${svc} uses some-dep@1.2.3 in deploy ${latest}"
  fi
done
```

## Container signing (already in main, integrated)

`.github/workflows/container-signing.yml` runs on `push: tags: v*` and:
1. Pulls the built image from ghcr.io
2. `cosign sign --yes <image>` (keyless OIDC, no long-lived keys)
3. Attaches SLSA L1 provenance attestation
4. Downloads SBOM artifact from `dependency-security.yml` workflow
5. Attaches SBOM as cosign attestation (cyclonedx type)

Consumer verifies signature + attestation before deploy:
```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/.+/aisha-orchestrator/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/aisha/svc-ai-chat:v1.2.3
```

## Rollback

### Disable Trivy gate (temporary, e.g. during pre-existing CVE remediation):
Set `--exit-code: '0'` in `.github/workflows/dependency-security.yml` step.
Existing SARIF still uploaded to GitHub Security tab for visibility, but
build proceeds. Re-enable when remediation complete.

### Disable MinIO mirror:
Unset `AISHA_MINIO_S3_PUBLIC_ENDPOINT` GHA secret. The step's `if: ${{ env.MINIO_PUBLIC_ENDPOINT != '' }}` skips gracefully.

### Disable cosign signing:
Delete `.github/workflows/container-signing.yml` from workflow dir.
Existing signatures stay valid in registry; new images won't be signed.

## References

- Phase 12 plan WP 3.8 (this file's parent spec)
- Trivy: https://trivy.dev/
- cosign: https://docs.sigstore.dev/cosign/overview/
- CycloneDX: https://cyclonedx.org/
- EU AI Act high-risk obligations: https://artificialintelligenceact.eu/ (SBOM requirement)
- WP 0.1b — Verdaccio token pattern (companion: secure private registry)
- WP 0.2 — MinIO bucket pattern (Loki uses same MinIO instance)
