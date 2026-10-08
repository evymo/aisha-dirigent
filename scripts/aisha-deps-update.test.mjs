import { describe, expect, it } from "vitest";
import { cilZProstredi, githubApi, upsertPullRequest } from "./aisha-deps-update.mjs";

const CIL = { api: "https://api.example.test", repo: "org/repo", token: "t" };

/** Falešné REST API: `odpovedi[METODA cesta]` → [status, tělo]; zaznamená volání. */
function api(odpovedi) {
  const volani = [];
  const f = async (url, init) => {
    const u = new URL(url);
    const klic = `${init.method} ${u.pathname}`;
    volani.push({ klic, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const [status, telo] = odpovedi[klic] ?? [500, { message: "neznámé volání" }];
    return new Response(telo === undefined ? "" : JSON.stringify(telo), { status });
  };
  return { f, volani };
}
const PR = { branch: "deps/root-development", base: "main", title: "chore(deps): x", body: "tělo" };

describe("kam se PR zakládají (jen z prostředí)", () => {
  it("repo, token i adresa API z běhu Actions; nic se nedosazuje", () => {
    expect(cilZProstredi({})).toEqual({ api: "", repo: "", token: "" });
    expect(cilZProstredi({ GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "a", GITHUB_API_URL: "https://ghe.example.test/api/v3/" })).toEqual({
      api: "https://ghe.example.test/api/v3",
      repo: "o/r",
      token: "a",
    });
    expect(cilZProstredi({ GH_TOKEN: "b" }).token).toBe("b");
  });
});

describe("idempotentní PR přes GitHub REST", () => {
  it("žádný otevřený PR z větve → založí nový (hlava filtrovaná vlastníkem:větví, Bearer token)", async () => {
    const { f, volani } = api({
      "GET /repos/org/repo/pulls": [200, []],
      "POST /repos/org/repo/pulls": [201, { number: 12 }],
    });
    expect(await upsertPullRequest({ ...CIL, f }, PR)).toEqual({ pr: 12 });
    expect(volani[0].query).toMatchObject({ state: "open", head: "org:deps/root-development" });
    expect(volani[1].body).toEqual({ title: PR.title, head: PR.branch, base: "main", body: PR.body });
    expect(new Set(volani.map((v) => v.auth))).toEqual(new Set(["Bearer t"]));
  });

  it("otevřený PR z téže větve → jen aktualizuje tělo, nezakládá duplikát", async () => {
    const { f, volani } = api({
      "GET /repos/org/repo/pulls": [200, [{ number: 7, head: { ref: PR.branch } }]],
      "PATCH /repos/org/repo/pulls/7": [200, { number: 7 }],
    });
    expect(await upsertPullRequest({ ...CIL, f }, PR)).toEqual({ pr: 7, updated: true });
    expect(volani.map((v) => v.klic)).toEqual(["GET /repos/org/repo/pulls", "PATCH /repos/org/repo/pulls/7"]);
  });

  it("⛔ selhání API je chyba s kódem, ne tiché „hotovo“", async () => {
    const zalozeni = api({ "GET /repos/org/repo/pulls": [200, []], "POST /repos/org/repo/pulls": [422, { message: "no commits" }] });
    expect((await upsertPullRequest({ ...CIL, f: zalozeni.f }, PR)).error).toMatch(/422/);
    const vyhledani = api({ "GET /repos/org/repo/pulls": [403, { message: "forbidden" }] });
    expect((await upsertPullRequest({ ...CIL, f: vyhledani.f }, PR)).error).toMatch(/lookup failed \(403\)/);
  });

  it("odpověď, která není JSON, se nevyhodí — rozhodne kód", async () => {
    const f = async () => new Response("<html>", { status: 502 });
    expect(await githubApi({ ...CIL, f }, "GET", "/x")).toEqual({ status: 502, json: null });
  });
});
