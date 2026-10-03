// Izolovaná instalace pro obraz publikace pluginů: jen uzavřená podmnožina lockfile.
import { describe, expect, it } from "vitest";
import { najdi, slozProjekt, uzaver, zavislostiPluginu } from "./zavislosti-z-lockfile.mjs";

// Tvar jako v package-lock v3 monorepa (zkrácený): hoisting, vnořená verze, volitelné platformy, dev příznaky.
const LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { name: "monorepo", workspaces: ["packages/*"] },
    "node_modules/esbuild": { version: "0.25.12", dev: true, optionalDependencies: { "@esbuild/linux-x64": "0.25.12", "@esbuild/aix-ppc64": "0.25.12" } },
    "node_modules/@esbuild/linux-x64": { version: "0.25.12", dev: true, optional: true, os: ["linux"], cpu: ["x64"] },
    "node_modules/minio": { version: "8.0.7", dependencies: { "block-stream2": "^2.1.0", "xml2js": "^0.5.0" } },
    "node_modules/block-stream2": { version: "2.1.0", dependencies: { "readable-stream": "^3.4.0" } },
    "node_modules/readable-stream": { version: "3.6.2" },
    "node_modules/minio/node_modules/xml2js": { version: "0.5.0", dependencies: { sax: ">=0.6.0" } },
    "node_modules/sax": { version: "1.4.1" },
    "node_modules/fast-xml-parser": { version: "5.7.3", dependencies: { strnum: "^2.1.0" } },
    "node_modules/strnum": { version: "2.1.1" },
    "node_modules/@sentry/core": { version: "10.55.0" }, // nikdo z podmnožiny ho nechce → nesmí se v ní objevit
    "node_modules/nas-balik": { resolved: "packages/nas-balik", link: true },
  },
};
const ROOT_PKG = { devDependencies: { esbuild: "^0.25.12", minio: "^8.0.7" } };
const PLUGINY = [
  { slug: "tcars-fleet", manifest: { dependencies: { "fast-xml-parser": "5.7.3" } } },
  { slug: "webdispecink-fleet", manifest: { dependencies: { "fast-xml-parser": "5.7.3" } } },
  { slug: "partner-metrics", manifest: { dependencies: {} } },
];

describe("rozřešení umístění", () => {
  it("nejdřív vnořená kopie, pak rodiče, pak nejvyšší úroveň", () => {
    expect(najdi(LOCK.packages, "node_modules/minio", "xml2js")).toBe("node_modules/minio/node_modules/xml2js");
    expect(najdi(LOCK.packages, "node_modules/minio/node_modules/xml2js", "sax")).toBe("node_modules/sax");
    expect(najdi(LOCK.packages, "node_modules/minio", "neni")).toBeNull();
  });
});

describe("uzavřená podmnožina", () => {
  it("vezme balík i celý jeho strom, nic víc; dev příznaky pryč", () => {
    const u = uzaver(LOCK, ["esbuild", "minio"]);
    expect(Object.keys(u).sort()).toEqual([
      "node_modules/@esbuild/linux-x64",
      "node_modules/block-stream2",
      "node_modules/esbuild",
      "node_modules/minio",
      "node_modules/minio/node_modules/xml2js",
      "node_modules/readable-stream",
      "node_modules/sax",
    ]);
    expect(u["node_modules/esbuild"].dev).toBeUndefined();
    expect(u["node_modules/@esbuild/linux-x64"]).toMatchObject({ optional: true, os: ["linux"] });
    expect(u["node_modules/@sentry/core"]).toBeUndefined();
  });

  it("volitelná závislost, kterou lockfile nemá, nevadí; povinná = STOP", () => {
    expect(() => uzaver(LOCK, ["esbuild"])).not.toThrow(); // @esbuild/aix-ppc64 v lockfile není
    const rozbity = { packages: { ...LOCK.packages, "node_modules/minio": { version: "8.0.7", dependencies: { chybi: "1" } } } };
    expect(() => uzaver(rozbity, ["minio"])).toThrow(/nekonzistentní/);
  });

  it("balík mimo nejvyšší úroveň nebo odkaz na workspace = STOP", () => {
    expect(() => uzaver(LOCK, ["neexistuje"])).toThrow(/nezná neexistuje/);
    expect(() => uzaver(LOCK, ["nas-balik"])).toThrow(/workspace/);
  });
});

describe("projekt pro obraz", () => {
  it("nástroje s rozsahem z package.json, pluginy s přesnou verzí z manifestu", () => {
    const { pkg, lock } = slozProjekt({ rootPkg: ROOT_PKG, lock: LOCK, nastroje: ["esbuild", "minio"], manifesty: PLUGINY });
    expect(pkg.dependencies).toEqual({ esbuild: "^0.25.12", minio: "^8.0.7", "fast-xml-parser": "5.7.3" });
    expect(lock.packages[""].dependencies).toEqual(pkg.dependencies);
    expect(lock.packages["node_modules/strnum"]).toBeDefined();
    expect(lock.packages["node_modules/@sentry/core"]).toBeUndefined();
  });

  it("nástroj nedeklarovaný v package.json = STOP", () => {
    expect(() => slozProjekt({ rootPkg: {}, lock: LOCK, nastroje: ["esbuild"], manifesty: [] })).toThrow(/není deklarován/);
  });

  it("manifest pluginu s jinou verzí, než drží lockfile = STOP", () => {
    const jina = [{ slug: "tcars-fleet", manifest: { dependencies: { "fast-xml-parser": "5.8.0" } } }];
    expect(() => slozProjekt({ rootPkg: ROOT_PKG, lock: LOCK, nastroje: ["esbuild"], manifesty: jina })).toThrow(/lockfile monorepa drží 5.7.3/);
  });

  it("dva pluginy chtějí různé verze téhož = STOP", () => {
    expect(() =>
      zavislostiPluginu([
        { slug: "a", manifest: { dependencies: { x: "1.0.0" } } },
        { slug: "b", manifest: { dependencies: { x: "2.0.0" } } },
      ]),
    ).toThrow(/jedna instalace neumí obojí/);
  });
});
