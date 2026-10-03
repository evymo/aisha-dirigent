/**
 * Brána: generátor typů DB je PŘIPNUTÝ a na loopbacku se nepokouší o TLS.
 *
 * ⛔ PROČ (třída hlášená 25. 9. jedním forkem, znovu 29. 9. Android): `npx supabase@latest`
 * stáhl 2.118.0 a generace typů nad zahazovací DB padala („Is the DB accessible?“).
 * Nepřipnutá verze nástroje, který ZAPISUJE soubor v repu, dělá z cizího vydání náš
 * rozbitý build — a každá relace, která typy přegeneruje, ho zanese dál. 2.118 navíc
 * zkouší TLS, které zahazovací DB nemá (`sslmode=disable` pro loopback řeší
 * scripts/db/lib/typegen-db-url.mjs).
 *
 * Hlídá:
 *  1. žádné `supabase@latest|next|beta|^…|~…` ani `npx supabase gen` bez verze v nástrojích
 *     a CI (scripts/, .forgejo/, package.json) — verze se zvedá VĚDOMÝM PR;
 *  2. TYPEGEN_CLI v gen-types.mjs je přesná verze;
 *  3. adresa pro generátor: loopback bez sslmode → sslmode=disable, jinak beze změny.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adresaProGeneratorTypu } from "../../../scripts/db/lib/typegen-db-url.mjs";

const ROOT = process.cwd();

/**
 * Soubory nástrojů a CI: celé `scripts/` a `.forgejo/` + každý `package.json` stromu.
 * Procházka, ne `git ls-files`: brána na lehké dráze nemá spouštět podproces
 * (ratchet `drahy-bran-manifest`). Závislosti a výstupy buildu se přeskakují.
 */
const PRESKOCIT = new Set(["node_modules", ".git", "dist", "trash", ".expo", "android", "ios"]);

function projdi(adresar: string, vezmi: (rel: string) => boolean, out: string[]): void {
  for (const d of readdirSync(join(ROOT, adresar), { withFileTypes: true })) {
    if (PRESKOCIT.has(d.name)) continue;
    const rel = adresar ? join(adresar, d.name) : d.name;
    if (d.isDirectory()) projdi(rel, vezmi, out);
    else if (d.isFile() && vezmi(rel)) out.push(rel);
  }
}

function sledovane(): string[] {
  const vse: string[] = [];
  for (const koren of ["scripts", ".forgejo"]) {
    if (existsSync(join(ROOT, koren))) projdi(koren, () => true, vse);
  }
  projdi("", (rel) => rel.endsWith("package.json") && !rel.startsWith("scripts") && !rel.startsWith(".forgejo"), vse);
  return vse.filter((f) =>
    /\.(mjs|cjs|js|ts|sh|ya?ml|json)$/.test(f) &&
    !f.endsWith("package-lock.json") &&
    !f.includes(".test.") &&
    !f.includes("__tests__/"));
}

const NEPRIPNUTY = /supabase@(?!\d+\.\d+\.\d+\b)[^\s"'`)]+|\bnpx\s+(?:--yes\s+|-y\s+)?supabase\s+gen\b/g;

describe("generátor typů: připnutá verze CLI", () => {
  it("měřidlo má dosah — nástroje, CI i package.json v libovolné hloubce", () => {
    const s = sledovane();
    expect(s).toContain("scripts/db/gen-types.mjs");
    expect(s).toContain("package.json");
    expect(s).toContain("mobile-app/package.json");
    expect(s.some((f) => /^\.forgejo\/.+\.ya?ml$/.test(f))).toBe(true);
    expect(s.some((f) => f.split("/").length >= 3 && f.endsWith("package.json"))).toBe(true);
    expect(s.some((f) => f.includes("node_modules/"))).toBe(false);
  });

  it("⛔ žádné nepřipnuté supabase CLI v nástrojích a CI", () => {
    const nalezy: string[] = [];
    for (const f of sledovane()) {
      const obsah = readFileSync(join(ROOT, f), "utf8");
      for (const radek of obsah.split("\n")) {
        if (radek.trim().startsWith("//") || radek.trim().startsWith("#") || radek.trim().startsWith("*")) continue;
        for (const m of radek.matchAll(NEPRIPNUTY)) nalezy.push(`${f}: ${m[0]}`);
      }
    }
    expect(nalezy, "verze CLI se zvedá vědomým PR s přegenerovanými typy, ne cizím vydáním").toEqual([]);
  });

  it("kontrolní vzorky měřidla (jinak by mlčelo naprázdno)", () => {
    const najdi = (s: string) => [...s.matchAll(NEPRIPNUTY)].map((m) => m[0]);
    expect(najdi('["--yes", "supabase@latest", "gen"]')).toEqual(["supabase@latest"]);
    expect(najdi("npx supabase gen types")).toEqual(["npx supabase gen"]);
    expect(najdi("npx -y supabase gen types typescript")).toEqual(["npx -y supabase gen"]);
    expect(najdi("npx supabase status")).toEqual([]);
    expect(najdi("npx supabase functions serve")).toEqual([]);
    expect(najdi("npx --yes supabase@^2.100.0")).toEqual(["supabase@^2.100.0"]);
    expect(najdi('const TYPEGEN_CLI = "supabase@2.117.0";')).toEqual([]);
    expect(najdi("npx --yes supabase@2.117.0 gen types")).toEqual([]);
  });

  it("TYPEGEN_CLI je přesná verze", () => {
    const zdroj = readFileSync(join(ROOT, "scripts/db/gen-types.mjs"), "utf8");
    expect(zdroj).toMatch(/const TYPEGEN_CLI = "supabase@\d+\.\d+\.\d+";/);
  });
});

describe("adresa pro generátor typů — sslmode jen na loopbacku", () => {
  it.each([
    ["postgresql://postgres:postgres@127.0.0.1:57601/postgres", "postgresql://postgres:postgres@127.0.0.1:57601/postgres?sslmode=disable"],
    ["postgres://u:p@localhost:5432/d", "postgres://u:p@localhost:5432/d?sslmode=disable"],
    ["postgresql://u:p@[::1]:5432/d?application_name=x", "postgresql://u:p@[::1]:5432/d?application_name=x&sslmode=disable"],
  ])("loopback bez sslmode: %s → sslmode=disable", (vstup, cekam) => {
    expect(adresaProGeneratorTypu(vstup)).toBe(cekam);
  });

  it.each([
    "postgresql://u:p@127.0.0.1:5432/d?sslmode=require",
    "postgresql://u:p@db.example.test:5432/d",
    "postgresql://u:p@10.0.0.5:5432/d",
    "host=127.0.0.1 port=5432 dbname=d",
  ])("⛔ beze změny: %s", (vstup) => {
    expect(adresaProGeneratorTypu(vstup)).toBe(vstup);
  });

  it("heslo s escapováním zůstane beze změny", () => {
    expect(adresaProGeneratorTypu("postgresql://u:KAN%40AREK@127.0.0.1:5432/d"))
      .toBe("postgresql://u:KAN%40AREK@127.0.0.1:5432/d?sslmode=disable");
  });
});
