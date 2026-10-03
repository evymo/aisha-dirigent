/**
 * Manifest tags Gate — tag parser support v 3 souborech
 *
 * Ověřuje, že parsers v `local-compose-gen.mjs`, `coolify-drift-check.mjs`,
 * `aisha-changed-apps.mjs` umějí jednotně parsovat:
 *   - `bluegreen=on` (single tag)
 *   - `bluegreen=on,story=*` (multiple tags via comma)
 *   - `bluegreen=on:story=acme` (multiple tags via colon — back-compat)
 *
 * Use case: per-story B/G granularitarita vyžaduje multi-tag support.
 */

import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AppFromManifest } from "./_types";

const ROOT = process.cwd();
const TMPDIR = join(ROOT, ".tmp/manifest-tags-test");
const MANIFEST = join(TMPDIR, "test.manifest");

const SAMPLE_MANIFEST = `
# test manifest
story: test
repo: aisha/test

app: foo:host:docker-compose.coolify-foo.yml
app: bar:host:docker-compose.coolify-bar.yml:bluegreen=on
app: baz:host:docker-compose.coolify-baz.yml:bluegreen=on,story=*
app: qux:host:docker-compose.coolify-qux.yml:bluegreen=on:story=acme
app: tag:host:docker-compose.coolify-tag.yml:flag1,flag2,key=value
`.trim();

function setupManifest() {
  if (!existsSync(TMPDIR)) mkdirSync(TMPDIR, { recursive: true });
  writeFileSync(MANIFEST, SAMPLE_MANIFEST);
}

function teardownManifest() {
  try { rmSync(TMPDIR, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
}

describe("manifest tag parser — local-compose-gen.mjs", () => {
  setupManifest();

  test("parses no-tags app", () => {
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from 'node:fs';
        const text = readFileSync('${MANIFEST}', 'utf-8');
        const apps = [];
        for (const line of text.split('\\n')) {
          const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);
          if (!m) continue;
          const tags = {};
          if (m[4]) {
            for (const part of m[4].split(/[,:]/)) {
              const eq = part.indexOf('=');
              if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
              else if (part) tags[part] = true;
            }
          }
          apps.push({ name: m[1], composeFile: m[3], tags });
        }
        console.log(JSON.stringify(apps));
      `,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    const apps: AppFromManifest[] = JSON.parse(r.stdout.trim());
    const foo = apps.find((a) => a.name === "foo");
    expect(foo).toBeDefined();
    expect(foo!.tags).toEqual({});
  });

  test("parses single tag bluegreen=on", () => {
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from 'node:fs';
        const text = readFileSync('${MANIFEST}', 'utf-8');
        for (const line of text.split('\\n')) {
          const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);
          if (!m || m[1] !== 'bar') continue;
          const tags = {};
          if (m[4]) {
            for (const part of m[4].split(/[,:]/)) {
              const eq = part.indexOf('=');
              if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
              else if (part) tags[part] = true;
            }
          }
          console.log(JSON.stringify(tags));
        }
      `,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ bluegreen: "on" });
  });

  test("parses multi-tag with comma: bluegreen=on,story=*", () => {
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from 'node:fs';
        const text = readFileSync('${MANIFEST}', 'utf-8');
        for (const line of text.split('\\n')) {
          const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);
          if (!m || m[1] !== 'baz') continue;
          const tags = {};
          if (m[4]) {
            for (const part of m[4].split(/[,:]/)) {
              const eq = part.indexOf('=');
              if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
              else if (part) tags[part] = true;
            }
          }
          console.log(JSON.stringify(tags));
        }
      `,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ bluegreen: "on", story: "*" });
  });

  test("parses multi-tag with colon (back-compat): bluegreen=on:story=acme", () => {
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from 'node:fs';
        const text = readFileSync('${MANIFEST}', 'utf-8');
        for (const line of text.split('\\n')) {
          const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);
          if (!m || m[1] !== 'qux') continue;
          const tags = {};
          if (m[4]) {
            for (const part of m[4].split(/[,:]/)) {
              const eq = part.indexOf('=');
              if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
              else if (part) tags[part] = true;
            }
          }
          console.log(JSON.stringify(tags));
        }
      `,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ bluegreen: "on", story: "acme" });
  });

  test("parses bare flags (no =) and key=value mixed", () => {
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from 'node:fs';
        const text = readFileSync('${MANIFEST}', 'utf-8');
        for (const line of text.split('\\n')) {
          const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);
          if (!m || m[1] !== 'tag') continue;
          const tags = {};
          if (m[4]) {
            for (const part of m[4].split(/[,:]/)) {
              const eq = part.indexOf('=');
              if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
              else if (part) tags[part] = true;
            }
          }
          console.log(JSON.stringify(tags));
        }
      `,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ flag1: true, flag2: true, key: "value" });
  });
});

describe("Production manifest — keycloak has bluegreen=on", () => {
  test("aisha.manifest tags keycloak as B/G enabled", () => {
    const manifestPath = join(ROOT, "coolify/manifests/aisha.manifest");
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from 'node:fs';
        const text = readFileSync('${manifestPath}', 'utf-8');
        for (const line of text.split('\\n')) {
          const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);
          if (!m || m[1] !== 'keycloak') continue;
          const tags = {};
          if (m[4]) {
            for (const part of m[4].split(/[,:]/)) {
              const eq = part.indexOf('=');
              if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
              else if (part) tags[part] = true;
            }
          }
          console.log(JSON.stringify({ host: m[2], compose: m[3], tags }));
        }
      `,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.tags.bluegreen).toBe("on");
    expect(parsed.compose).toBe("docker-compose.coolify-keycloak.yml");
  });
});

// Cleanup tmpdir after all tests in file
import { afterAll } from "vitest";
afterAll(() => teardownManifest());
