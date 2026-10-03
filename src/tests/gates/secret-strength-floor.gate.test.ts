/**
 * GATE: preserved-secret strength floor (generate-secrets.mjs)
 *
 * Incident class (verified in production 2026-06-12): the preserve-first
 * logic in scripts/generate-secrets.mjs (`pg()` = preserve_or_gen) recycled
 * ANY existing value from .env.coolify / the vault forever — including legacy
 * values that predate the current strength policy:
 *
 *   - JWT_SECRET preserved at length 20 → PostgREST hard-requires
 *     jwt-secret ≥ 32 chars → PostgREST crashlooped on a fresh post-wipe
 *     stack, core never went healthy, cold-start aborted.
 *   - POSTGRES_PASSWORD preserved at length 9 (generator default secret(32)).
 *
 * This gate locks the fix:
 *   1. STATELESS keys (JWT_SECRET — signing material, no volume state) below
 *      the floor are ALWAYS discarded and re-keyed, on any run.
 *   2. When JWT_SECRET is re-keyed, the dependent ANON_KEY/SERVICE_ROLE_KEY
 *      JWTs are regenerated in the same run even if present (old ones are
 *      signed by the previous secret → signature mismatch).
 *   3. STATEFUL keys (DB passwords etc. — may back live volumes; stock
 *      postgres images do NOT reconcile roles on start) below the floor are
 *      only WARNed about on normal runs, and re-keyed only under
 *      --strength-floor / AISHA_SECRET_STRENGTH_FLOOR=1, which
 *      aisha-cold-start.sh passes on --wipe runs (volumes purged → safe).
 *   4. Healthy-length values are NEVER re-keyed (floors are conservative:
 *      every generator emits ≥ 32 chars, floors are 24 general / 32 for
 *      JWT_SECRET).
 *   5. WARN lines go to stderr ONLY — stdout is eval'd by the cold-start.
 */
import { describe, expect, test } from "vitest";
import { createHmac } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

const HEALTHY_JWT_SECRET = "healthy-jwt-secret-0123456789abcdefgh"; // 37 ≥ 32
const HEALTHY_PASSWORD = "healthy-password-0123456789"; // 27 ≥ 24
const SHORT_JWT_SECRET = "shortjwt20charsxxxxx"; // 20 < 32 (real incident length)
const SHORT_PASSWORD = "short9pwd"; // 9 < 24 (real incident length)

/** Run the real generator against a fixture .env.coolify. */
function runGenerator(
  fixtureLines: string[],
  extraArgs: string[] = [],
): { stdout: string; stderr: string; env: Map<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "aisha-secret-floor-"));
  try {
    const coolify = join(dir, ".env.coolify");
    writeFileSync(
      coolify,
      [
        // keep bip39 out of the hot path (mnemonic preserved from fixture)
        "COSMOS_SIGNER_MNEMONIC=fixture mnemonic words only",
        ...fixtureLines,
        "",
      ].join("\n"),
    );
    // Scrub ambient values — process.env is a preserve source for pg(), and a
    // pre-armed AISHA_SECRET_STRENGTH_FLOOR would flip the non-flag scenarios.
    // The fixture must declare its instance: generate-secrets no longer guesses one.
    const scrubbed: Record<string, string | undefined> = { ...process.env, APP_NAME_PREFIX: "aisha" };
    for (const key of [
      "AISHA_SECRET_STRENGTH_FLOOR",
      "PRESERVE_STATEFUL_SECRETS",
      "JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "POSTGRES_PASSWORD",
      "KEYCLOAK_DB_PASSWORD",
      "NETBIRD_DB_PASSWORD",
      "LIVEKIT_API_KEY",
      "MINIO_ROOT_USER",
    ]) {
      delete scrubbed[key];
    }
    const result = spawnSync(
      "node",
      [
        join(ROOT, "scripts/generate-secrets.mjs"),
        "--preserve=1",
        `--env-coolify=${coolify}`,
        `--env-backup=${join(dir, "missing.env-prod-backup")}`,
        ...extraArgs,
      ],
      { cwd: ROOT, env: scrubbed, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const env = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)='(.*)'$/.exec(line);
      if (m) env.set(m[1], m[2]);
    }
    return { stdout: result.stdout, stderr: result.stderr, env };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Assert `jwt` is an HS256 JWT signed by `secret` carrying `role`. */
function expectSignedBy(jwt: string, secret: string, role: string): void {
  const [h, p, sig] = jwt.split(".");
  expect(sig, `JWT for role=${role} has no signature part`).toBeTruthy();
  const expected = createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64url")
    .replace(/=+$/, "");
  expect(sig, `JWT for role=${role} is not signed by the emitted JWT_SECRET`).toBe(expected);
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  expect(payload.role).toBe(role);
}

describe("preserved-secret strength floor", () => {
  test("short preserved JWT_SECRET is re-keyed on a NORMAL run and the dependent JWTs regenerate", () => {
    const staleAnon = "stale.anon.jwt-signed-by-old-secret";
    const staleService = "stale.service.jwt-signed-by-old-secret";
    const { stdout, stderr, env } = runGenerator([
      `JWT_SECRET=${SHORT_JWT_SECRET}`,
      `ANON_KEY=${staleAnon}`,
      `SERVICE_ROLE_KEY=${staleService}`,
    ]);

    // Re-keyed: old 20-char value gone, fresh value satisfies PostgREST's ≥ 32.
    const jwtSecret = env.get("JWT_SECRET")!;
    expect(jwtSecret).not.toBe(SHORT_JWT_SECRET);
    expect(jwtSecret.length).toBeGreaterThanOrEqual(32);

    // Dependency contract: ANON_KEY/SERVICE_ROLE_KEY MUST NOT survive a
    // JWT_SECRET re-key — old ones fail signature verification in PostgREST.
    expect(env.get("ANON_KEY")).not.toBe(staleAnon);
    expect(env.get("SERVICE_ROLE_KEY")).not.toBe(staleService);
    expectSignedBy(env.get("ANON_KEY")!, jwtSecret, "anon");
    expectSignedBy(env.get("SERVICE_ROLE_KEY")!, jwtSecret, "service_role");

    // Loud WARN with key, old length, floor + consequence — on stderr.
    expect(stderr).toMatch(/WARN.*JWT_SECRET.*length 20.*floor \(32\)/s);
    expect(stderr).toMatch(/PostgREST/);
    expect(stderr).toMatch(/WARN.*ANON_KEY.*DISCARDED/s);
    expect(stderr).toMatch(/WARN.*SERVICE_ROLE_KEY.*DISCARDED/s);
    // stdout is eval'd by aisha-cold-start.sh — WARNs must never leak into it.
    expect(stdout).not.toContain("WARN");
  });

  test("healthy-length preserved values are untouched (floor must never re-key valid secrets)", () => {
    const { stderr, env } = runGenerator([
      `JWT_SECRET=${HEALTHY_JWT_SECRET}`,
      `POSTGRES_PASSWORD=${HEALTHY_PASSWORD}`,
      `KEYCLOAK_DB_PASSWORD=${HEALTHY_PASSWORD}`,
      // Exempt-by-design keys: identifier-ish / empty-by-design values must
      // never trip the floor even though they are short.
      "LIVEKIT_API_KEY=API1a2b3c4d5e",
      "MINIO_ROOT_USER=aisha-minio-admin",
    ]);

    expect(env.get("JWT_SECRET")).toBe(HEALTHY_JWT_SECRET);
    expect(env.get("POSTGRES_PASSWORD")).toBe(HEALTHY_PASSWORD);
    expect(env.get("KEYCLOAK_DB_PASSWORD")).toBe(HEALTHY_PASSWORD);
    expect(env.get("LIVEKIT_API_KEY")).toBe("API1a2b3c4d5e");
    expect(env.get("MINIO_ROOT_USER")).toBe("aisha-minio-admin");
    expect(stderr).not.toContain("WARN");

    // Preserved JWT_SECRET → preserved-or-derived dependents still verify.
    expectSignedBy(env.get("ANON_KEY")!, HEALTHY_JWT_SECRET, "anon");
    expectSignedBy(env.get("SERVICE_ROLE_KEY")!, HEALTHY_JWT_SECRET, "service_role");
  });

  test("preserved dependents survive when JWT_SECRET itself is preserved", () => {
    const first = runGenerator([`JWT_SECRET=${HEALTHY_JWT_SECRET}`]);
    const anon = first.env.get("ANON_KEY")!;
    const service = first.env.get("SERVICE_ROLE_KEY")!;

    const second = runGenerator([
      `JWT_SECRET=${HEALTHY_JWT_SECRET}`,
      `ANON_KEY=${anon}`,
      `SERVICE_ROLE_KEY=${service}`,
    ]);
    expect(second.env.get("ANON_KEY")).toBe(anon);
    expect(second.env.get("SERVICE_ROLE_KEY")).toBe(service);
  });

  test("stateful key below floor WITHOUT the wipe flag: preserved unchanged + WARN (never break live volumes)", () => {
    const { stderr, env } = runGenerator([
      `JWT_SECRET=${HEALTHY_JWT_SECRET}`,
      `POSTGRES_PASSWORD=${SHORT_PASSWORD}`,
      `NETBIRD_DB_PASSWORD=${SHORT_PASSWORD}`,
    ]);

    // netbird-db / langfuse run stock postgres images that do NOT reconcile
    // roles on container start — re-keying here would brick running stacks.
    expect(env.get("POSTGRES_PASSWORD")).toBe(SHORT_PASSWORD);
    expect(env.get("NETBIRD_DB_PASSWORD")).toBe(SHORT_PASSWORD);
    expect(stderr).toMatch(/WARN.*POSTGRES_PASSWORD.*length 9.*floor \(24\).*PRESERVED/s);
    expect(stderr).toMatch(/WARN.*NETBIRD_DB_PASSWORD.*PRESERVED/s);
  });

  test("stateful key below floor WITH --strength-floor=1 (wipe run): re-keyed + WARN", () => {
    const { stderr, env } = runGenerator(
      [
        `JWT_SECRET=${HEALTHY_JWT_SECRET}`,
        `POSTGRES_PASSWORD=${SHORT_PASSWORD}`,
        `KEYCLOAK_DB_PASSWORD=${HEALTHY_PASSWORD}`,
      ],
      ["--strength-floor=1"],
    );

    const fresh = env.get("POSTGRES_PASSWORD")!;
    expect(fresh).not.toBe(SHORT_PASSWORD);
    expect(fresh.length).toBeGreaterThanOrEqual(24);
    // Healthy values stay put even under the flag.
    expect(env.get("KEYCLOAK_DB_PASSWORD")).toBe(HEALTHY_PASSWORD);
    expect(env.get("JWT_SECRET")).toBe(HEALTHY_JWT_SECRET);
    expect(stderr).toMatch(/WARN.*POSTGRES_PASSWORD.*length 9.*floor \(24\).*DISCARDED/s);
  });

  test("AISHA_SECRET_STRENGTH_FLOOR=1 env var arms the floor like the CLI flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "aisha-secret-floor-envvar-"));
    try {
      const coolify = join(dir, ".env.coolify");
      writeFileSync(
        coolify,
        [
          "COSMOS_SIGNER_MNEMONIC=fixture mnemonic words only",
          `JWT_SECRET=${HEALTHY_JWT_SECRET}`,
          `POSTGRES_PASSWORD=${SHORT_PASSWORD}`,
          "",
        ].join("\n"),
      );
      const result = spawnSync(
        "node",
        [
          join(ROOT, "scripts/generate-secrets.mjs"),
          "--preserve=1",
          `--env-coolify=${coolify}`,
        ],
        {
          cwd: ROOT,
          env: { ...process.env, APP_NAME_PREFIX: "aisha", AISHA_SECRET_STRENGTH_FLOOR: "1", POSTGRES_PASSWORD: "" },
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(`POSTGRES_PASSWORD='${SHORT_PASSWORD}'`);
      expect(result.stderr).toMatch(/WARN.*POSTGRES_PASSWORD.*DISCARDED/s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cold-start arms --strength-floor exactly on wipe-with-volume-purge runs", () => {
    const coldStart = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");

    // Flag is wired into the generate-secrets invocation…
    expect(coldStart).toContain('--strength-floor="$_strength_floor"');
    // …armed only when the wipe will actually purge volumes (--keep-volumes
    // keeps stateful volumes → stateful re-key would break them)…
    expect(coldStart).toMatch(
      /if \[ "\$WIPE" = "1" \] && \[ "\$WIPE_VOLUMES" = "1" \]; then\n\s*_strength_floor=1/,
    );
    // …and operator-overridable via the documented env var.
    expect(coldStart).toContain('_strength_floor="${AISHA_SECRET_STRENGTH_FLOOR:-0}"');
  });

  test("BYOK/operator keys stay floor-exempt by construction (preservedValue, not pg)", () => {
    const generator = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf8");
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_AI_API_KEY",
      "RESEND_API_KEY",
      "TELEGRAM_BOT_TOKEN",
      "NETBIRD_API_TOKEN",
    ]) {
      expect(generator, `${key} must flow through preservedValue() (no floor), not pg()`).toMatch(
        new RegExp(`preservedValue\\('${key}'`),
      );
      expect(generator, `${key} must NOT be pg()-managed (floor would re-key operator keys)`).not.toMatch(
        new RegExp(`pg\\('${key}'`),
      );
    }
    // Identity / empty-by-design keys are explicitly exempt.
    const exemptBlock = /const FLOOR_EXEMPT = new Set\(\[([\s\S]*?)\]\)/.exec(generator)?.[1] ?? "";
    expect(exemptBlock, "FLOOR_EXEMPT set missing from generate-secrets.mjs").not.toBe("");
    for (const key of ["COSMOS_SIGNER_MNEMONIC", "LIVEKIT_API_KEY", "PKI_CLIENT_KEY_B64"]) {
      expect(exemptBlock, `${key} must be listed in FLOOR_EXEMPT`).toContain(`'${key}'`);
    }
  });
});
