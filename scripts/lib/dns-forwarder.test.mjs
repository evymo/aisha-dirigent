import { describe, expect, test } from "vitest";
import { overForwarder } from "./dns-forwarder.mjs";

describe("forwarder mesh DNS je deklarace instance, ne resolver stroje operátora", () => {
  test("resolver LAN serverů projde", () => {
    expect(overForwarder("192.0.2.53")).toEqual({ ok: true, ip: "192.0.2.53" });
    expect(overForwarder(" 198.51.100.53 ")).toEqual({ ok: true, ip: "198.51.100.53" });
    expect(overForwarder("2001:db8::53").ok).toBe(true);
  });

  test("⛔ co by přinesl notebook na hotspotu (naměřeno 2026-09-16) se odmítne", () => {
    expect(overForwarder("fe80::dcb5:4fff:fe9b:cc64%en0").ok).toBe(false);
    expect(overForwarder("fe80::dcb5:4fff:fe9b:cc64").ok).toBe(false);
  });

  test("nedeklarovaná, loopback, link-local a nesmysl jsou chyba s důvodem", () => {
    for (const spatne of ["", undefined, "127.0.0.53", "::1", "169.254.1.1", "0.0.0.0", "resolver.lan", "300.1.1.1"]) {
      const v = overForwarder(spatne);
      expect(v.ok, `„${spatne}" prošlo`).toBe(false);
      expect(v.duvod.length).toBeGreaterThan(10);
    }
  });
});
