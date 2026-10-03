/**
 * No-Latest-Images Gate Test
 *
 * Blokuje PR, který znovu zavádí nepinovanou upstream image referenci — v
 * JAKÉKOLI z forem, kde se může schovat:
 *
 *   1. `image: <something>:latest` v docker-compose.coolify-*.yml
 *   2. `FROM <something>:latest` (nebo BEZ tagu = implicitní :latest) uvnitř
 *      `build.dockerfile_inline` bloků v compose souborech
 *   3. `FROM <something>:latest` / bez tagu ve standalone Dockerfile* souborech
 *
 * Why: `:latest` způsobuje tiché regrese. Případy z praxe:
 *   - Netbird `NETBIRD_STORE_*` → `NB_STORE_*` rename mezi minor verzemi
 *   - 2026-06-11: `ghcr.io/element-hq/element-call:latest` tiše driftnul base na
 *     nginx-unprivileged (USER 101) → build RUN do root-owned /docker-entrypoint.d
 *     spadl permission-denied a zablokoval produkční deploy aisha-messaging
 *     (fix PR #373). Původní verze tohoto gate kontrolovala JEN `image:` řádky,
 *     takže FROM v dockerfile_inline byl slepé místo — proto tahle rozšířená verze.
 *
 * Single source of truth pro pinning je `config/image-versions.env`; compose
 * soubory referencují přes `${IMAGE_X:-fallback}` pattern. U FROM v inline
 * dockerfiles se pinuje přímo verzí/digestem (s datovaným komentářem).
 *
 * Povolené formy (nepovažují se za drift):
 *   - verzní tag (`:v1.2.3`, `:3.20`, `:22-alpine`, `:pg17`, …)
 *   - digest pin (`@sha256:…`)
 *   - `${IMAGE_X:-fallback}` wrapping (env-override pattern; fallback smí
 *     obsahovat :latest — runtime override je pro prod vyžadován)
 *   - celá reference je `${VAR}` (operator-pinned base, např. NETBIRD_BASE_IMAGE)
 *   - multi-stage alias (`FROM deps AS build` → `FROM deps`)
 *   - `FROM scratch`
 *
 * POZOR: `${REGISTRY_PROXY}img:latest` JE drift — proxy prefix nemění tag.
 *
 * Pokud test failuje, oprav přes:
 *   1. Pin v `config/image-versions.env` (přidej IMAGE_X=registry/name:vX.Y.Z)
 *      a compose `image:` referencuj přes `${IMAGE_X:-…}`, NEBO
 *   2. u FROM v dockerfile_inline / Dockerfile pinuj konkrétní verzní tag
 *      (ověř digest přes `docker buildx imagetools inspect`) + datovaný komentář.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

const ROOT = process.cwd();

function listComposeFiles(): string[] {
  const files = readdirSync(ROOT)
    .filter(f => f.startsWith("docker-compose.coolify") && f.endsWith(".yml"))
    .sort();
  return files;
}

/** Recursively collect tracked standalone Dockerfiles (Dockerfile, Dockerfile.<x>). */
function listDockerfiles(): string[] {
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".claude"]);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
      } else if (/^Dockerfile(\..+)?$/.test(basename(full))) {
        out.push(full.slice(ROOT.length + 1));
      }
    }
  };
  walk(ROOT);
  return out.sort();
}

function findLatestRefs(content: string, _file: string): { line: number; text: string; reason: string }[] {
  // `image:` refs follow the SAME pinning rules as FROM (see unpinnedReason).
  // Allow `${IMAGE_X:-...}` even if fallback contains `:latest` — that's a
  // documented fallback, not a runtime tag (env var override is required for prod).
  //
  // ⛔ 2026-09-14: do té doby tu stálo „`${...}` cokoli projde" — a tím prošel
  // `image: ${REGISTRY_PROXY}minio/mc` BEZ tagu. Docker Hub repozitář smazal,
  // nasazení brokeru odstranilo staré kontejnery a na stažení obrazu spadlo.
  const lines = content.split("\n");
  const hits: { line: number; text: string; reason: string }[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith("#")) return;
    // Match image: directive
    if (!trimmed.startsWith("image:")) return;

    const value = trimmed.slice("image:".length).trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    const reason = unpinnedReason(value);
    if (reason) hits.push({ line: idx + 1, text: trimmed, reason });
  });

  return hits;
}

/**
 * Why a single image ref is unpinned, or null when it is pinned.
 * Shared by `image:` lines and FROM lines so the two surfaces cannot drift apart.
 */
function unpinnedReason(ref: string): string | null {
  // OK: digest-pinned (immutable)
  if (ref.includes("@sha256:")) return null;
  // OK: env-override pinning pattern
  if (ref.startsWith("${IMAGE_")) return null;
  // OK: the ENTIRE ref is a single `${VAR}` — operator-pinned base image
  // (e.g. ${NETBIRD_BASE_IMAGE}). A mere `${REGISTRY_PROXY}` PREFIX does NOT
  // qualify — the tag still decides pinned-ness.
  if (/^\$\{[^}]+\}$/.test(ref)) return null;

  // Extract the tag: text after the last ':' that occurs AFTER the last '/'
  // (so a registry port like `myreg:5000/img` is not mistaken for a tag).
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  const tag = lastColon > lastSlash ? ref.slice(lastColon + 1) : null;

  if (tag === null) return "no tag (implicit :latest)";
  if (tag === "latest") return "raw :latest tag";
  return null;
}

/**
 * Find unpinned `FROM` refs (raw `:latest` OR missing tag = implicit latest) in
 * Dockerfile content — works for both standalone Dockerfiles and compose
 * `dockerfile_inline` blocks (line-based, indentation-agnostic).
 *
 * Exported shape mirrors findLatestRefs so failure output is uniform.
 */
function findUnpinnedFromRefs(content: string): { line: number; text: string; reason: string }[] {
  const lines = content.split("\n");
  const hits: { line: number; text: string; reason: string }[] = [];
  // Multi-stage aliases defined so far (`FROM x AS deps` → "deps" usable later).
  const stageAliases = new Set<string>();

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return;
    const m = trimmed.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+[Aa][Ss]\s+(\S+))?\s*$/);
    if (!m) return;
    const ref = m[1];
    if (m[2]) stageAliases.add(m[2]);

    // OK: reference to a previously declared build stage
    if (stageAliases.has(ref)) return;
    // OK: the empty base image
    if (ref === "scratch") return;

    const reason = unpinnedReason(ref);
    if (reason) hits.push({ line: idx + 1, text: trimmed, reason });
  });

  return hits;
}

function formatFromError(file: string, hits: { line: number; text: string; reason: string }[]): string {
  const formatted = hits.map(h => `  ${file}:${h.line}: ${h.text}   ← ${h.reason}`).join("\n");
  return (
    `\nFound ${hits.length} unpinned FROM reference(s) in ${file}:\n${formatted}\n\n` +
    `Fix: pin a concrete version tag (verify digest via \`docker buildx imagetools inspect\`)\n` +
    `with a dated comment, or pin by digest (img@sha256:…). Raw :latest / untagged FROM\n` +
    `is the silent-drift class that broke the element-call build (PR #373).\n`
  );
}

describe("No :latest images in Coolify compose files", () => {
  const composeFiles = listComposeFiles();

  test("at least one compose file is present", () => {
    expect(composeFiles.length).toBeGreaterThan(0);
  });

  test.each(composeFiles)("no raw :latest in %s", (file) => {
    const path = join(ROOT, file);
    const content = readFileSync(path, "utf-8");
    const hits = findLatestRefs(content, file);

    if (hits.length > 0) {
      const formatted = hits.map(h => `  ${file}:${h.line}: ${h.text}   ← ${h.reason}`).join("\n");
      throw new Error(
        `\nFound ${hits.length} unpinned image reference(s) in ${file}:\n${formatted}\n\n` +
        `Fix: Pin image v config/image-versions.env a referencuj přes \${IMAGE_X:-fallback}.\n` +
        `Example:\n` +
        `  # config/image-versions.env\n` +
        `  IMAGE_FOO=registry/name:v1.2.3\n\n` +
        `  # docker-compose.coolify-X.yml\n` +
        `  image: \${IMAGE_FOO:-registry/name:v1.2.3}\n`
      );
    }
    expect(hits.length).toBe(0);
  });

  test("config/image-versions.env exists", () => {
    const versions = join(ROOT, "config/image-versions.env");
    const content = readFileSync(versions, "utf-8");
    expect(content.length).toBeGreaterThan(100);
    expect(content).toMatch(/IMAGE_NETBIRD=/);
    expect(content).toMatch(/IMAGE_SYNAPSE=/);
  });
});

describe("No unpinned FROM in dockerfile_inline blocks (compose)", () => {
  // The blind spot that let element-call:latest drift (PR #373): the image:
  // scan above never sees FROM lines inside build.dockerfile_inline. A
  // line-based FROM scan over the whole YAML covers them regardless of nesting.
  const composeFiles = listComposeFiles();

  test.each(composeFiles)("no unpinned FROM in %s", (file) => {
    const content = readFileSync(join(ROOT, file), "utf-8");
    const hits = findUnpinnedFromRefs(content);
    if (hits.length > 0) throw new Error(formatFromError(file, hits));
    expect(hits.length).toBe(0);
  });
});

describe("No unpinned FROM in standalone Dockerfiles", () => {
  // Same drift class, third surface: Dockerfile / Dockerfile.<svc> files.
  const dockerfiles = listDockerfiles();

  test("Dockerfiles are discovered (non-empty sanity check)", () => {
    expect(dockerfiles.length).toBeGreaterThan(10);
  });

  test.each(dockerfiles)("no unpinned FROM in %s", (file) => {
    const content = readFileSync(join(ROOT, file), "utf-8");
    const hits = findUnpinnedFromRefs(content);
    if (hits.length > 0) throw new Error(formatFromError(file, hits));
    expect(hits.length).toBe(0);
  });
});

describe("findUnpinnedFromRefs — parser contract (type-class self-tests)", () => {
  // Pure-function assertions so a future "simplification" of the regex cannot
  // silently reopen the blind spot. Each case is a real form from this repo.
  const flag = (s: string) => findUnpinnedFromRefs(s);

  test("flags raw :latest", () => {
    expect(flag("FROM vectorim/element-web:latest")).toHaveLength(1);
    expect(flag("        FROM ghcr.io/element-hq/element-call:latest")).toHaveLength(1);
  });

  test("flags untagged ref (implicit :latest)", () => {
    const hits = flag("FROM nginx");
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("implicit");
  });

  test("flags :latest behind a registry-proxy PREFIX (prefix does not pin)", () => {
    expect(flag("FROM ${REGISTRY_PROXY}library/nginx:latest")).toHaveLength(1);
  });

  test("accepts version tags, digests, and registry ports", () => {
    expect(flag("FROM alpine:3.20")).toHaveLength(0);
    expect(flag("FROM ghcr.io/element-hq/element-call:v0.20.1")).toHaveLength(0);
    expect(flag("FROM ${REGISTRY_PROXY}library/node:22-alpine AS build")).toHaveLength(0);
    expect(flag("FROM img@sha256:" + "a".repeat(64))).toHaveLength(0);
    // registry port is not a tag — untagged ref on a ported registry still flags
    expect(flag("FROM myreg:5000/img")).toHaveLength(1);
    expect(flag("FROM myreg:5000/img:v1")).toHaveLength(0);
  });

  test("accepts ${IMAGE_*} wrapping and whole-ref ${VAR} bases", () => {
    expect(flag("FROM ${IMAGE_FOO:-registry/name:latest}")).toHaveLength(0);
    expect(flag("FROM ${NETBIRD_BASE_IMAGE}")).toHaveLength(0);
    expect(flag("FROM ${MATRIX_RTC_AUTH_BASE_IMAGE}")).toHaveLength(0);
  });

  test("accepts multi-stage aliases and scratch; skips comments", () => {
    const multi = ["FROM node:22-alpine AS deps", "FROM deps AS migrator", "FROM scratch"].join("\n");
    expect(flag(multi)).toHaveLength(0);
    expect(flag("# FROM nginx:latest — comment only")).toHaveLength(0);
  });

  test("image: lines obey the same rules — a proxy prefix does not pin", () => {
    const img = (s: string) => findLatestRefs(s, "x.yml");
    expect(img("    image: ${REGISTRY_PROXY}minio/mc")).toHaveLength(1);
    expect(img("    image: ${REGISTRY_PROXY}library/caddy:latest")).toHaveLength(1);
    expect(img("    image: minio/mc")).toHaveLength(1);
    expect(img("    image: ${REGISTRY_PROXY}library/caddy:2-alpine")).toHaveLength(0);
    expect(img("    image: ${IMAGE_RCLONE:?pin z config/image-versions.env}")).toHaveLength(0);
    expect(img("    image: ${IMAGE_FOO:-registry/name:latest}")).toHaveLength(0);
    expect(img('    image: "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine"  # pin')).toHaveLength(0);
  });

  test("handles --platform flag", () => {
    expect(flag("FROM --platform=linux/amd64 alpine:3.20")).toHaveLength(0);
    expect(flag("FROM --platform=linux/amd64 alpine")).toHaveLength(1);
    // Tvar docker/minio/Dockerfile: platforma builderu + prefix cache + tag@digest.
    expect(flag("FROM --platform=$BUILDPLATFORM ${REGISTRY_PROXY}library/golang:1.24.13-alpine3.23@sha256:" + "a".repeat(64) + " AS go")).toHaveLength(0);
  });
});
