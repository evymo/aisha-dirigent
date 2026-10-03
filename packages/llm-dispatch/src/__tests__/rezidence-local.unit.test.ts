/**
 * Rezidence dat: v režimu `AISHA_EXECUTION_MODE=local` registr cloudový backend
 * VŮBEC NEZAREGISTRUJE — ani z továrny (klíč v prostředí), ani přes `addBackend`.
 *
 * ⛔ PROČ SCHOPNOST, NE FILTR: `resolveBackends` cloud v local režimu vynechával,
 * ale router svc-ai-chat bere backend i přímo z `getAllBackends()` (pinProvider,
 * gateway, záložní hledání podle id, re-resolve po selhání, stream). Stačil
 * cloudový klíč v prostředí a otázka i s daty odešla ven. Co v registru není,
 * to žádná z těch cest nezavolá.
 *
 * Kontrolní vzorek: TÝŽ klíč v režimu `cloud` backend zaregistruje — jinak by
 * test prošel i nad registrem, který neregistruje nic.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BackendRegistry } from "../backendRegistry.js";
import { OpenAICompatBackend } from "../providers/openai-compat.js";

const ENV_KLICE = [
  "AISHA_EXECUTION_MODE",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "GEMINI_API_KEY",
  "XAI_API_KEY",
  "OLLAMA_URL",
  "DOCKER_MODEL_RUNNER_URL",
  "VLLM_GENERATION_URL",
  "MAESTRO_URL",
  "MAESTRO_API_KEY",
  "AISHA_LLM_GATEWAY_URL",
  "AISHA_LLM_GATEWAY_KEY",
];

const puvodni: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KLICE) {
    puvodni[k] = process.env[k];
    delete process.env[k];
  }
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Cloud i lokál jsou „nakonfigurované" — rozhoduje jen režim.
  process.env.OPENAI_API_KEY = "sk-test-atrapa";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-atrapa";
  process.env.VLLM_GENERATION_URL = "http://127.0.0.1:8000/v1";
});

afterEach(() => {
  for (const k of ENV_KLICE) {
    if (puvodni[k] === undefined) delete process.env[k];
    else process.env[k] = puvodni[k];
  }
  vi.restoreAllMocks();
});

const idcka = (r: BackendRegistry) => r.getAllBackends().map((b) => b.id).sort();

const cloudovy = () =>
  new OpenAICompatBackend({
    id: "cloud-z-registru",
    label: "test",
    baseUrl: "https://api.example.invalid/v1",
    kind: "cloud",
    supportsTools: false,
    modelPrefixes: [],
  });

const lokalni = () =>
  new OpenAICompatBackend({
    id: "lokalni-z-registru",
    label: "test",
    baseUrl: "http://127.0.0.1:8001/v1",
    kind: "local",
    supportsTools: false,
    modelPrefixes: [],
  });

describe("rezidence dat — local režim neregistruje cloud", () => {
  test("kontrolní vzorek: v režimu cloud se cloudové backendy zaregistrují", () => {
    process.env.AISHA_EXECUTION_MODE = "cloud";
    const ids = idcka(new BackendRegistry());
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("vllm");
  });

  test("local: z továrny jen lokální backendy, cloudové ani s klíčem ne", () => {
    process.env.AISHA_EXECUTION_MODE = "local";
    const r = new BackendRegistry();
    const ids = idcka(r);
    expect(ids).toContain("vllm");
    expect(ids).not.toContain("openai");
    expect(ids).not.toContain("anthropic");
    expect(r.getAllBackends().every((b) => b.kind === "local")).toBe(true);
  });

  test("local: addBackend cloudový backend odmítne, lokální přijme", () => {
    process.env.AISHA_EXECUTION_MODE = "local";
    const r = new BackendRegistry();
    r.addBackend(cloudovy());
    r.addBackend(lokalni());
    const ids = idcka(r);
    expect(ids).not.toContain("cloud-z-registru");
    expect(ids).toContain("lokalni-z-registru");
  });

  test("local: odmítnutí se hlásí nahlas (ne tiché zmizení backendu)", () => {
    process.env.AISHA_EXECUTION_MODE = "local";
    new BackendRegistry().getAllBackends();
    const hlasky = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(hlasky.some((h) => h.includes('"openai"') && h.includes("AISHA_EXECUTION_MODE=local"))).toBe(true);
  });
});
