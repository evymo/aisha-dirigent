/**
 * Gate: every EXPO_PUBLIC_* var read through a *dynamic* lookup must be
 * forwarded via app.config.ts `extra`.
 *
 * The Expo babel plugin only inlines *static* `process.env.EXPO_PUBLIC_X` member
 * access. Both getExpoEnv/getExpoExtra fall back to a computed `process.env[key]`,
 * which is left untouched and resolves to undefined in a release bundle — so
 * `extra` is the only channel that reaches the app. A var that is read but never
 * forwarded is silently dead in exactly the builds we ship, while dev builds and
 * tsc/jest/lint all stay green. That is how the Keycloak authority shipped empty
 * and broke login on every release build.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectSourceFiles(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

function dynamicallyReadKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of collectSourceFiles(join(ROOT, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /getExpo(?:Env|Extra)\(\s*["'](EXPO_PUBLIC_[A-Z0-9_]+)["']\s*\)/g,
    )) {
      keys.add(match[1]!);
    }
  }
  return keys;
}

function forwardedKeys(): Set<string> {
  const config = readFileSync(join(ROOT, "app.config.ts"), "utf8");
  const start = config.indexOf("extra: {");
  if (start === -1) throw new Error("app.config.ts has no `extra` block");
  const keys = new Set<string>();
  for (const match of config.slice(start).matchAll(/(EXPO_PUBLIC_[A-Z0-9_]+)\s*:/g)) {
    keys.add(match[1]!);
  }
  return keys;
}

describe("app.config.ts extra forwarding", () => {
  it("forwards every dynamically-read EXPO_PUBLIC_* var", () => {
    const forwarded = forwardedKeys();
    const missing = [...dynamicallyReadKeys()].filter((key) => !forwarded.has(key)).sort();
    expect(missing).toEqual([]);
  });

  // Without this, a regex that matches nothing would make the gate above pass
  // vacuously — the exact failure mode it exists to catch.
  it("actually finds the vars it guards", () => {
    const read = dynamicallyReadKeys();
    expect(read.size).toBeGreaterThan(5);
    expect(read.has("EXPO_PUBLIC_KC_AUTHORITY")).toBe(true);
    expect(forwardedKeys().has("EXPO_PUBLIC_KC_AUTHORITY")).toBe(true);
  });
});
