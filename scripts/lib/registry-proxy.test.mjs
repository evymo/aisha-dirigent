import { describe, expect, it } from "vitest";
import { domovRegistryProxy, registryProxyBuildArgs, rozlisRegistryProxy } from "./registry-proxy.mjs";

describe("registryProxyBuildArgs", () => {
  it("bez proměnné nepředá nic — výchozí hodnotu nese Dockerfile", () => {
    expect(registryProxyBuildArgs({})).toEqual([]);
    expect(registryProxyBuildArgs({ REGISTRY_PROXY: "" })).toEqual([]);
  });

  it("nastavená proměnná jde do build-arg beze změny", () => {
    expect(registryProxyBuildArgs({ REGISTRY_PROXY: "cache.example/" })).toEqual([
      "--build-arg",
      "REGISTRY_PROXY=cache.example/",
    ]);
  });

  it("⛔ prefix bez lomítka zastaví — jinak `cache.examplepgvector/…`", () => {
    expect(() => registryProxyBuildArgs({ REGISTRY_PROXY: "cache.example" })).toThrow(/lomítkem/);
  });
});

describe("domov REGISTRY_PROXY", () => {
  it("čte holou pomlčku z image-versions.env", () => {
    expect(domovRegistryProxy("A=1\nREGISTRY_PROXY=${REGISTRY_PROXY-cache.example/}\nB=2")).toBe("cache.example/");
  });

  it("⛔ `:-` (prázdné = nastaveno) za domov nepovažuje — přesně ten tvar odvození zabil", () => {
    expect(() => domovRegistryProxy("REGISTRY_PROXY=${REGISTRY_PROXY:-}")).toThrow(/domov/);
  });

  it("prázdný domov nebo bez lomítka zastaví", () => {
    expect(() => domovRegistryProxy("REGISTRY_PROXY=${REGISTRY_PROXY-}")).toThrow(/lomítkem/);
    expect(() => domovRegistryProxy("REGISTRY_PROXY=${REGISTRY_PROXY-cache.example}")).toThrow(/lomítkem/);
  });
});

describe("rozlišení REGISTRY_PROXY", () => {
  const domov = "cache.example/";

  it("bez deklarace platí domov", () => {
    expect(rozlisRegistryProxy({ domov })).toEqual({ hodnota: domov, zdroj: "domov" });
    expect(rozlisRegistryProxy({ deklarace: { ma: false }, domov })).toEqual({ hodnota: domov, zdroj: "domov" });
  });

  it("výslovně PRÁZDNÁ deklarace = vypnutá cache (nouze), ne domov", () => {
    expect(rozlisRegistryProxy({ deklarace: { ma: true, hodnota: "" }, domov })).toEqual({ hodnota: "", zdroj: "deklarace" });
  });

  it("deklarovaný jiný prefix vyhrává; uvozovky zápisu pryč", () => {
    expect(rozlisRegistryProxy({ deklarace: { ma: true, hodnota: "'mirror.example/'" }, domov }).hodnota).toBe("mirror.example/");
  });

  it("⛔ deklarace bez lomítka zastaví", () => {
    expect(() => rozlisRegistryProxy({ deklarace: { ma: true, hodnota: "mirror.example" }, domov })).toThrow(/lomítkem/);
  });
});
