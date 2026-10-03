/**
 * Operator-inputs source-of-truth gate
 *
 * scripts/lib/operator-inputs.mjs is the ONE schema of operator-supplied inputs.
 * This gate keeps every consumer honest:
 *   • the generated config/fork-instance-inputs.env.example must match the schema
 *     byte-for-byte (no drift between the doc an operator reads and reality);
 *   • the schema must never ask for a value the stack GENERATES itself (secrets,
 *     JWT-derived keys, DB passwords) — those are self-served, not operator input;
 *   • NOTHING provider- or model-specific is hardcoded here — credential/BYOK
 *     inputs are PARSED from config/external-secrets.required.env (@annotations),
 *     so "everything dynamic" holds and there is no second place to maintain;
 *   • every input is well-formed and every example is a non-sensitive placeholder.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  OPERATOR_INPUTS,
  CATEGORIES,
  renderEnvExample,
  requiredInputs,
  toJson,
  parseExternalSecrets,
} from "../../../scripts/lib/operator-inputs.mjs";

const ROOT = process.cwd();
const ENV_EXAMPLE = "config/fork-instance-inputs.env.example";

describe("operator-inputs schema is the single source of truth", () => {
  test("generated env example is committed and in sync with the schema (no drift)", () => {
    const path = join(ROOT, ENV_EXAMPLE);
    expect(existsSync(path), `${ENV_EXAMPLE} must be committed (generate: node scripts/operator-setup.mjs --print-env-example > ${ENV_EXAMPLE})`).toBe(true);
    const onDisk = readFileSync(path, "utf8");
    expect(
      onDisk,
      `${ENV_EXAMPLE} is stale — regenerate: node scripts/operator-setup.mjs --print-env-example > ${ENV_EXAMPLE}`,
    ).toBe(renderEnvExample());
  });

  test("schema asks ONLY for non-derivable inputs — never a self-generated secret", () => {
    // These are produced by scripts/generate-secrets.mjs (crypto-random, preserved)
    // or derived — an operator must NEVER be asked for them.
    const SELF_GENERATED = [
      "POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY",
      "VAULT_ENCRYPTION_KEY", "COLUMN_ENCRYPTION_KEY", "KEYCLOAK_ADMIN_PASSWORD",
      "KEYCLOAK_DB_PASSWORD", "KEYCLOAK_CLIENT_SECRET", "LANGFUSE_DB_PASSWORD",
      "LANGFUSE_NEXTAUTH_SECRET", "LANGFUSE_SALT", "LANGFUSE_ENCRYPTION_KEY",
    ];
    const keys = new Set(OPERATOR_INPUTS.map((i) => i.key));
    const leaked = SELF_GENERATED.filter((k) => keys.has(k));
    expect(leaked, `schema asks for self-generated value(s): ${leaked.join(", ")}`).toEqual([]);
  });

  test("every input is well-formed (key, category, label, description, example)", () => {
    const bad: string[] = [];
    for (const i of OPERATOR_INPUTS) {
      if (!i.key) bad.push("(missing key)");
      if (!CATEGORIES[i.category as keyof typeof CATEGORIES]) bad.push(`${i.key}: unknown category ${i.category}`);
      if (!i.label) bad.push(`${i.key}: no label`);
      if (!i.description) bad.push(`${i.key}: no description`);
      // non-secret, non-file inputs must carry a placeholder example; secret
      // credentials intentionally have none (the real value is supplied out of band).
      if (!i.example && !i.secret && !i.file) bad.push(`${i.key}: no example`);
    }
    expect(bad).toEqual([]);
  });

  test("examples are non-sensitive placeholders (no real domains / no dotted infra hosts)", () => {
    // Public-safe examples only: example.com / acme / fictional. Guards against a
    // real domain or credential sneaking into the committed template.
    const offenders: string[] = [];
    for (const i of OPERATOR_INPUTS) {
      if (i.secret || i.file) continue; // secret tokens + file paths aren't hosts
      const ex = String(i.example);
      const hosts = ex.match(/\b[a-z0-9-]+\.[a-z0-9.-]+\.[a-z]{2,}\b/gi) || [];
      for (const h of hosts) {
        if (!/(^|\.)(example\.(com|net|org)|acme\.example\.com|acme\.internal|mesh\.acme\.internal)$/i.test(h)) {
          offenders.push(`${i.key}: ${h}`);
        }
      }
    }
    expect(offenders, `non-placeholder host in an example: ${offenders.join(", ")}`).toEqual([]);
  });

  test("there is at least one required input in each core category and the JSON contract is stable", () => {
    for (const cat of ["infra-endpoints", "topology"]) {
      expect(requiredInputs().some((i) => i.category === cat), `no required input in category ${cat}`).toBe(true);
    }
    const json = toJson();
    expect(Object.keys(json.categories)).toEqual(Object.keys(CATEGORIES));
    expect(json.inputs.length).toBe(OPERATOR_INPUTS.length);
  });
});

describe("credential/BYOK inputs are DYNAMIC — parsed, never hardcoded (everything dynamic)", () => {
  test("operator-inputs.mjs hardcodes NO provider/model name — providers come from the @annotated SoT", () => {
    const src = readFileSync(join(ROOT, "scripts/lib/operator-inputs.mjs"), "utf8");
    const banned = src.match(/\b(openai|anthropic|claude|gemini|cohere|sentry|telegram|netbird|resend|gpt-[0-9])\b/gi) || [];
    expect(
      banned,
      `operator-inputs.mjs hardcodes provider/model name(s): [${[...new Set(banned)].join(", ")}] — ` +
        "they must be parsed from config/external-secrets.required.env, not baked into the schema",
    ).toEqual([]);
  });

  test("parseExternalSecrets derives credentials from the file and excludes @generated keys", () => {
    const { inputs } = parseExternalSecrets();
    const keys = new Set(inputs.map((i) => i.key));
    // real external credentials flow through
    expect(keys.has("OPENAI_API_KEY") || keys.has("COOLIFY_API_KEY"), "no external credential parsed from the SoT").toBe(true);
    // every parsed input is a secret and carries a category
    expect(inputs.every((i) => i.secret === true && i.category), "a parsed external input is not marked secret/categorised").toBe(true);
    // @generated keys (regenerated by cold-start / tool-filled) are NOT operator inputs
    for (const gen of ["ANON_KEY", "SERVICE_ROLE_KEY", "N8N_API_KEY"]) {
      expect(keys.has(gen), `@generated key ${gen} leaked into operator inputs`).toBe(false);
    }
  });

  test("credentials are genuinely file-derived (not a hardcoded snapshot)", () => {
    // A missing SoT file yields ZERO parsed inputs — proof the list is READ from
    // config/external-secrets.required.env, not returned from a baked-in array.
    expect(parseExternalSecrets("/nonexistent/external-secrets.required.env").inputs).toEqual([]);
    expect(parseExternalSecrets().inputs.length).toBeGreaterThan(0);
  });
});
