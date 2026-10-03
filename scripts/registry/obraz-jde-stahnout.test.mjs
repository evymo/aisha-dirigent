/**
 * obraz-jde-stahnout — měřidlo musí umět říct „CHYBÍ" i „NEZMĚŘENO", ne jen „DOSTUPNÝ".
 * Registr se napodobuje injektovaným fetch (žádná síť v testu).
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildyZCompose,
  dosad,
  obrazyZDockerfile,
  odkazyFrom,
  odkazyZCompose,
  piny,
  promenneZEnv,
  rozeber,
  soupis,
  vyzva,
  zmer,
} from "./obraz-jde-stahnout.mjs";

/** Falešný registr: `stavy` říká, co vrátí manifest bez/s tokenem a token endpoint. */
function registr({ bezTokenu = 401, sTokenem = 200, token = 200, vyzvaHlavicka = true } = {}) {
  const volani = [];
  const fetchImpl = async (url, opts = {}) => {
    volani.push({ url: String(url), auth: opts.headers?.Authorization ?? null });
    const hlavicky = new Map();
    if (String(url).includes("/token")) {
      return {
        status: token,
        headers: { get: () => null },
        json: async () => (token === 200 ? { token: "anon-tok" } : {}),
      };
    }
    const maToken = Boolean(opts.headers?.Authorization);
    const status = maToken ? sTokenem : bezTokenu;
    if (status === 401 && vyzvaHlavicka) {
      hlavicky.set("www-authenticate", 'Bearer realm="https://reg.example/token",service="reg.example",scope="repository:org/app:pull"');
    }
    return { status, headers: { get: (k) => hlavicky.get(k.toLowerCase()) ?? null }, json: async () => ({}) };
  };
  return { fetchImpl, volani };
}

describe("piny z config/image-versions.env", () => {
  it("čte IMAGE_*, odstraní ${REGISTRY_PROXY} (měří se veřejný originál), přeskočí neúplné", () => {
    const text = [
      "# komentář",
      "IMAGE_A=${REGISTRY_PROXY}library/redis:7-alpine",
      "IMAGE_B=quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z",
      'IMAGE_C="ghcr.io/org/app:1.2.3"',
      "IMAGE_D=${NECO_JINEHO}/x:1",
      "JINE=foo:1",
    ].join("\n");
    expect(piny(text)).toEqual([
      { klic: "IMAGE_A", obraz: "library/redis:7-alpine" },
      { klic: "IMAGE_B", obraz: "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z" },
      { klic: "IMAGE_C", obraz: "ghcr.io/org/app:1.2.3" },
    ]);
  });
});

describe("co se skutečně stahuje: compose a Dockerfile", () => {
  it("compose: image: s literálem i s REGISTRY_PROXY; ARG a :local se přeskočí", () => {
    const yml = [
      "services:",
      "  a:",
      "    image: ${REGISTRY_PROXY}library/redis:7-alpine",
      '  b:\n    image: "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine"',
      "  c:\n    image: ${IMAGE_NGINX}",
      "  d:\n    image: svc-source-broker:local",
      "  e:",
      "    build:",
      "      dockerfile_inline: |",
      "        FROM ghcr.io/element-hq/element-call:v0.20.1 AS web",
      "        FROM web",
    ].join("\n");
    expect(odkazyZCompose(yml).sort()).toEqual(
      ["ghcr.io/element-hq/element-call:v0.20.1", "library/redis:7-alpine", "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine"].sort(),
    );
  });

  it("Dockerfile: FROM bez aliasů stage, ARG a scratch; --platform nevadí", () => {
    const df = [
      "ARG BASE=node:22",
      "FROM ${REGISTRY_PROXY}library/node:22-alpine AS deps",
      "FROM --platform=linux/amd64 quay.io/keycloak/keycloak:26.0.8",
      "FROM deps AS build",
      "FROM ${BASE}",
      "FROM scratch",
    ].join("\n");
    expect(odkazyFrom(df)).toEqual(["library/node:22-alpine", "quay.io/keycloak/keycloak:26.0.8"]);
  });
});

describe("co staví compose: build bloky, ARG a args (2026-09-27)", () => {
  it("dosazení: výchozí hodnoty, `:?` bez hodnoty je nedosazené, REGISTRY_PROXY vždy prázdné", () => {
    const v = { A: "1", PRAZDNE: "" };
    expect(dosad("x${A}y$A", v)).toEqual({ hodnota: "x1y1" });
    expect(dosad("${B:-def}/${PRAZDNE:-p}/${PRAZDNE-q}", v)).toEqual({ hodnota: "def/p/" });
    expect(dosad("${REGISTRY_PROXY}library/node:22", { REGISTRY_PROXY: "cache.example/" })).toEqual({ hodnota: "library/node:22" });
    expect(dosad("pg${B:?chybí}", v)).toEqual({ hodnota: null, chybi: "B" });
    expect(dosad("${B:-${C}}", v)).toEqual({ hodnota: null, chybi: "C" });
  });

  it("hodnoty image-versions.env: i ne-piny (POSTGRES_MAJOR) a odkazy mezi nimi", () => {
    const env = ["REGISTRY_PROXY=${REGISTRY_PROXY-cache.example/}", "IMAGE_X=${REGISTRY_PROXY}org/x:1", "POSTGRES_MAJOR=18", "AISHA_DB_IMAGE=db-pg${POSTGRES_MAJOR}:local"].join("\n");
    expect(promenneZEnv(env)).toEqual({ IMAGE_X: "org/x:1", POSTGRES_MAJOR: "18", AISHA_DB_IMAGE: "db-pg18:local" });
  });

  it("build bloky: krátký tvar, context+dockerfile+args (mapa i seznam), kotva ano, alias a inline ne", () => {
    const yml = [
      "services:",
      "  a:",
      "    build: ./services/a",
      "  b:",
      "    build: &spolecny",
      "      context: .",
      "      dockerfile: infra/b/Dockerfile   # komentář",
      "      args:",
      "        PG_MAJOR: ${POSTGRES_MAJOR:?}",
      '        REGISTRY_PROXY: "${REGISTRY_PROXY:-}"',
      "    image: b:local",
      "  b2:",
      "    build: *spolecny",
      "  c:",
      "    build:",
      "      context: deploy",
      "      args:",
      "        - BASE=org/c:2",
      "  d:",
      "    build:",
      "      dockerfile_inline: |",
      "        FROM org/d:1",
    ].join("\n");
    expect(buildyZCompose(yml)).toEqual([
      { context: "./services/a", dockerfile: "Dockerfile", args: {} },
      { context: ".", dockerfile: "infra/b/Dockerfile", args: { PG_MAJOR: "${POSTGRES_MAJOR:?}", REGISTRY_PROXY: "${REGISTRY_PROXY:-}" } },
      { context: "deploy", dockerfile: "Dockerfile", args: { BASE: "org/c:2" } },
    ]);
  });

  it("Dockerfile: args buildu > výchozí ARG; ARG z ARG; bez hodnoty = nedosazené (ne ticho)", () => {
    const df = [
      "ARG REGISTRY_PROXY=",
      "ARG PG_MAJOR",
      "ARG GO=golang:1.24",
      "ARG GO_IMAGE=${GO}@sha256:abc",
      "ARG CHYBI",
      "FROM ${REGISTRY_PROXY}pgvector/pgvector:pg${PG_MAJOR}",
      "FROM ${GO_IMAGE} AS go",
      "FROM go",
      "FROM ${CHYBI}",
      "ARG POZDNI=org/pozde:1",
      "FROM ${POZDNI}",
    ].join("\n");
    expect(obrazyZDockerfile(df, { PG_MAJOR: "18" })).toEqual({
      obrazy: ["pgvector/pgvector:pg18", "golang:1.24@sha256:abc"],
      nedosazene: [
        { ref: "${CHYBI}", chybi: "CHYBI" },
        // ARG až za prvním FROM FROM nevidí — Docker ho tam taky nedosadí.
        { ref: "${POZDNI}", chybi: "POZDNI" },
      ],
    });
    expect(obrazyZDockerfile(df, {}).nedosazene.map((n) => n.chybi)).toContain("PG_MAJOR");
  });

  it("soupis: Dockerfile v PODADRESÁŘI s args z compose a hodnotou z image-versions.env; nedosazené je NEZMĚŘENO", () => {
    const koren = mkdtempSync(join(tmpdir(), "obrazy-soupis-"));
    try {
      mkdirSync(join(koren, "config"));
      mkdirSync(join(koren, "infra/db"), { recursive: true });
      writeFileSync(join(koren, "config/image-versions.env"), "IMAGE_A=${REGISTRY_PROXY}org/a:1\nPOSTGRES_MAJOR=18\n");
      writeFileSync(
        join(koren, "docker-compose.x.yml"),
        ["services:", "  db:", "    build:", "      context: .", "      dockerfile: infra/db/Dockerfile", "      args:", "        PG_MAJOR: ${POSTGRES_MAJOR:?}", "  zmizely:", "    build: ./nikde"].join("\n"),
      );
      writeFileSync(join(koren, "infra/db/Dockerfile"), "ARG PG_MAJOR\nFROM ${REGISTRY_PROXY}pgvector/pgvector:pg${PG_MAJOR}\n");
      writeFileSync(join(koren, "Dockerfile.samostatny"), "ARG BEZ\nFROM ${BEZ}\n");
      const { seznam, nemeritelne } = soupis("config/image-versions.env", { koren });
      expect(seznam.map((s) => s.obraz).sort()).toEqual(["org/a:1", "pgvector/pgvector:pg18"]);
      expect(nemeritelne.map((n) => `${n.klic}: ${n.duvod}`).sort()).toEqual([
        "Dockerfile.samostatny: ARG BEZ bez výchozí hodnoty",
        "docker-compose.x.yml: build Dockerfile nikde/Dockerfile ve stromu není",
      ]);
    } finally {
      rmSync(koren, { recursive: true, force: true });
    }
  });
});

describe("rozbor odkazu na obraz", () => {
  it("Docker Hub je výchozí a krátké jméno dostane library/", () => {
    expect(rozeber("redis:7")).toMatchObject({ registr: "docker.io", api: "https://registry-1.docker.io", repo: "library/redis", ref: "7" });
    expect(rozeber("netbirdio/netbird:0.70.0")).toMatchObject({ registr: "docker.io", repo: "netbirdio/netbird", ref: "0.70.0" });
  });
  it("registr s tečkou nebo portem, tag i digest", () => {
    expect(rozeber("quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z")).toMatchObject({ registr: "quay.io", repo: "minio/mc", ref: "RELEASE.2025-08-13T08-35-41Z" });
    expect(rozeber("reg.local:5000/a/b@sha256:abc")).toMatchObject({ registr: "reg.local:5000", repo: "a/b", ref: "sha256:abc" });
    expect(rozeber("ghcr.io/org/app")).toMatchObject({ ref: "latest" });
    // tag + digest: stahuje se digest, tag ze jména repozitáře pryč (jinak 404 = falešné CHYBÍ)
    expect(rozeber("library/golang:1.24.13-alpine3.23@sha256:abc")).toMatchObject({ repo: "library/golang", ref: "sha256:abc" });
    expect(rozeber("reg.local:5000/a/b:1.2@sha256:def")).toMatchObject({ registr: "reg.local:5000", repo: "a/b", ref: "sha256:def" });
  });
  it("výzva Bearer se přečte, cizí schéma ne", () => {
    expect(vyzva('Bearer realm="https://a/token",service="a"')).toEqual({ realm: "https://a/token", service: "a" });
    expect(vyzva('Basic realm="x"')).toBeNull();
  });
});

describe("měření proti falešnému registru", () => {
  it("DOSTUPNÝ: 401 výzva → anonymní token → 200", async () => {
    const { fetchImpl, volani } = registr();
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "DOSTUPNÝ" });
    expect(volani.at(-1).auth).toBe("Bearer anon-tok");
  });

  it("CHYBÍ: 401 i S anonymním tokenem (quay.io/minio 2026-09-24)", async () => {
    const { fetchImpl } = registr({ sTokenem: 401 });
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "CHYBÍ" });
  });

  it("CHYBÍ: 404 (Docker Hub minio 2026-09-11)", async () => {
    const { fetchImpl } = registr({ sTokenem: 404 });
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "CHYBÍ" });
  });

  it("CHYBÍ: registr nevydá ani anonymní token", async () => {
    const { fetchImpl } = registr({ token: 401 });
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "CHYBÍ" });
  });

  it("holé 401 BEZ výzvy NENÍ nález — NEZMĚŘENO", async () => {
    const { fetchImpl } = registr({ vyzvaHlavicka: false });
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "NEZMĚŘENO" });
  });

  it("výpadek sítě NENÍ „obraz zmizel“ — NEZMĚŘENO", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND reg.example");
    };
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "NEZMĚŘENO" });
  });

  it("5xx registru je NEZMĚŘENO, ne CHYBÍ", async () => {
    const { fetchImpl } = registr({ sTokenem: 503 });
    expect(await zmer("reg.example/org/app:1", { fetchImpl })).toMatchObject({ stav: "NEZMĚŘENO" });
  });
});
