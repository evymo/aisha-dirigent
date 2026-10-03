/**
 * Integration test for scripts/verdaccio-mint-token.mjs
 *
 * Drives the real script via a child process with a preloaded fetch mock for
 * Verdaccio web-login + whoami endpoints. This proves the mint path without
 * Docker, a real registry, or a local TCP listener. The full flow (mint + actual
 * `npm publish`) was also verified live against verdaccio:6.5.2 with
 * `max_users: -1` on 2026-06-13.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

const pexec = promisify(execFile);
const SCRIPT = path.resolve(__dirname, "../../../scripts/verdaccio-mint-token.mjs");
const GOOD_PW = "goodpass-123";
const MOCK_TOKEN = "MOCK_JWT_TOKEN_abcdef0123456789";

let mockDir: string;
let fetchMockLoader: string;

beforeAll(async () => {
  mockDir = await mkdtemp(path.join(tmpdir(), "verdaccio-mint-token-"));
  fetchMockLoader = path.join(mockDir, "mock-fetch.mjs");
  await writeFile(
    fetchMockLoader,
    `
const goodPassword = process.env.VERDACCIO_MOCK_GOOD_PASSWORD;
const token = process.env.VERDACCIO_MOCK_TOKEN;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.endsWith("/-/verdaccio/sec/login") && init.method === "POST") {
    let creds = {};
    try {
      creds = JSON.parse(String(init.body ?? "{}"));
    } catch {
      // handled by the 401 response below
    }
    if (creds.password === goodPassword) {
      return new Response(JSON.stringify({ token }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "bad credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.endsWith("/-/whoami")) {
    const authorization = init.headers?.Authorization ?? init.headers?.authorization;
    if (authorization === \`Bearer \${token}\`) {
      return new Response(JSON.stringify({ username: process.env.VERDACCIO_USER }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("", { status: 401 });
  }

  return new Response("", { status: 404 });
};
`,
    "utf8",
  );
});

afterAll(async () => {
  await rm(mockDir, { recursive: true, force: true });
});

async function run(
  env: Record<string, string>,
  args: string[] = [],
): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await pexec("node", [SCRIPT, ...args], {
      env: {
        ...process.env,
        VERDACCIO_MOCK_GOOD_PASSWORD: GOOD_PW,
        VERDACCIO_MOCK_TOKEN: MOCK_TOKEN,
        NODE_OPTIONS: `--import=${pathToFileURL(fetchMockLoader).href}`,
        ...env,
      },
    });
    return { code: 0, out: stdout, err: stderr };
  } catch (e: unknown) {
    const x = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof x.code === "number" ? x.code : 1, out: x.stdout ?? "", err: x.stderr ?? "" };
  }
}

describe("verdaccio-mint-token.mjs", () => {
  it("no-op (exit 0, empty stdout) when VERDACCIO_USER/PASSWORD absent — back-compat", async () => {
    const r = await run({ VERDACCIO_URL: "https://verdaccio.test", VERDACCIO_USER: "", VERDACCIO_PASSWORD: "" });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("mints a token and prints ONLY the token on stdout", async () => {
    const r = await run({ VERDACCIO_URL: "https://verdaccio.test", VERDACCIO_USER: "ci", VERDACCIO_PASSWORD: GOOD_PW });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(MOCK_TOKEN);
  });

  it("--check verifies the token via /-/whoami before printing", async () => {
    const r = await run(
      { VERDACCIO_URL: "https://verdaccio.test", VERDACCIO_USER: "ci", VERDACCIO_PASSWORD: GOOD_PW },
      ["--check"],
    );
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(MOCK_TOKEN);
    expect(r.err).toContain("verified");
  });

  it("fails loudly (exit 1) on bad credentials", async () => {
    const r = await run({ VERDACCIO_URL: "https://verdaccio.test", VERDACCIO_USER: "ci", VERDACCIO_PASSWORD: "WRONG" });
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe("");
    expect(r.err).toMatch(/HTTP 401/);
  });

  it("fails (exit 1) when credentials present but VERDACCIO_URL missing", async () => {
    const r = await run({ VERDACCIO_URL: "", VERDACCIO_USER: "ci", VERDACCIO_PASSWORD: GOOD_PW });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/VERDACCIO_URL not set/);
  });
});
