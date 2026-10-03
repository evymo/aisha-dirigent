import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  const path = resolve(ROOT, rel);
  expect(existsSync(path), `expected ${rel} to exist`).toBe(true);
  return readFileSync(path, "utf8");
}

function listFiles(rel: string): string[] {
  const root = resolve(ROOT, rel);
  if (!existsSync(root)) return [];

  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        out.push(path);
      }
    }
  };
  walk(root);
  return out;
}

describe("AISHA runtime surfaces", () => {
  test("Workbench bundles the current Dirigent extension from source, not a stale VSIX", () => {
    const build = read("workbench/build.sh");
    const install = read("workbench/build/install_bundled_extensions.sh");

    expect(build).toContain("build/install_bundled_extensions.sh");
    expect(install).toContain("tests/e2e-dirigent/scripts/build-extension-vsix.mjs");
    expect(install).toContain('FORCE_REBUILD=1 node "$DIRIGENT_BUILD_SCRIPT"');
    expect(install).toContain('install_vsix "$DIRIGENT_VSIX"');
    expect(install).toContain("Skipping stale aisha-dirigent VSIX");
    expect(install).toContain(".aisha-workbench");

    const staleBundledDirigent = listFiles("workbench/bundled-extensions")
      .map((path) => basename(path))
      .filter((name) => /^aisha-dirigent.*\.vsix$/i.test(name));

    expect(
      staleBundledDirigent,
      `aisha-dirigent must be built from extensions/aisha-dirigent, not committed under workbench/bundled-extensions: ${staleBundledDirigent.join(", ")}`,
    ).toEqual([]);
  });

  test("mobile and desktop shells share the public app-config bootstrap and api-core transport", () => {
    const template = JSON.parse(read("public/.well-known/app-config.template.json")) as Record<string, unknown>;
    const mobileApi = read("mobile-app/src/config/api.ts");
    const extensionBootstrap = read("extensions/aisha-dirigent/src/bootstrap.ts");
    const extensionRpc = read("extensions/aisha-dirigent/src/backend-rpc.ts");

    for (const key of [
      "aisha_url",
      "anon_key",
      "keycloak_url",
      "mcp_url",
      "orchestration_url",
      "web_url",
    ]) {
      expect(template[key], `${key} missing from public app-config template`).toBeTruthy();
    }

    expect(mobileApi).toContain(".well-known/app-config.json");
    expect(mobileApi).toContain("EXPO_PUBLIC_BOOTSTRAP_URL");
    expect(mobileApi).toContain("createApiCore");
    expect(extensionBootstrap).toContain(".well-known/app-config.json");
    expect(extensionBootstrap).toContain("AppBootstrapConfig");
    expect(extensionRpc).toContain("createApiCore");
  });

  test("plugin LLM and sandbox execution stay behind gateway and broker-token controls", () => {
    const pluginConfig = read("services/svc-plugin-system/src/config.ts");
    const pluginLlm = read("services/svc-plugin-system/src/llm-router.ts");
    const pluginBroker = read("services/svc-plugin-system/src/broker-secret.ts");
    const runnerBroker = read("services/svc-agent-runner/src/broker-secret.ts");

    expect(pluginConfig).toContain("/functions/v1/ai-generate");
    expect(pluginConfig).toContain("BROKER_TOKEN_SECRET");
    expect(pluginLlm).toContain("config.aiGenerateUrl");
    expect(pluginLlm).toContain("plugin_sandbox");
    expect(pluginBroker).toContain("BROKER_TOKEN_SECRET is required");
    expect(runnerBroker).toContain("BROKER_TOKEN_SECRET is required");
  });
});
