import { describe, it, expect, beforeEach } from "vitest";
import { klicRozepsaneho, nactiRozepsane, smazRozepsane, ulozRozepsane } from "@/lib/novinky/rozepsanyText";

beforeEach(() => window.localStorage.clear());

describe("rozepsaný text v prohlížeči", () => {
  it("klíč je per článek, nový článek má vlastní", () => {
    expect(klicRozepsaneho("abc")).toBe("novinky.rozepsane.abc");
    expect(klicRozepsaneho(null)).toBe("novinky.rozepsane.novy");
  });
  it("uloží, načte i s časem a smaže", () => {
    const k = klicRozepsaneho("a1");
    ulozRozepsane(k, { slug: "x", title: { cs: "Ahoj" } }, new Date("2026-09-24T14:32:00Z"));
    const z = nactiRozepsane<{ slug: string }>(k);
    expect(z?.ulozeno).toBe("2026-09-24T14:32:00.000Z");
    expect(z?.data.slug).toBe("x");
    smazRozepsane(k);
    expect(nactiRozepsane(k)).toBeNull();
  });
  it("poškozený nebo cizí záznam se nebere", () => {
    window.localStorage.setItem("novinky.rozepsane.b", "{nevalidni");
    expect(nactiRozepsane("novinky.rozepsane.b")).toBeNull();
    window.localStorage.setItem("novinky.rozepsane.c", JSON.stringify({ data: 1 }));
    expect(nactiRozepsane("novinky.rozepsane.c")).toBeNull();
  });
  it("bez localStorage se nic nerozbije", () => {
    const puvodni = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(() => ulozRozepsane("k", { a: 1 })).not.toThrow();
      expect(nactiRozepsane("k")).toBeNull();
      expect(() => smazRozepsane("k")).not.toThrow();
    } finally {
      if (puvodni) Object.defineProperty(window, "localStorage", puvodni);
    }
  });
});
