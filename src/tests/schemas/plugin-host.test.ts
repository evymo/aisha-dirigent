/**
 * `source_spec.host` — kde plugin běží.
 *
 * Predikát čte build (scripts/plugins/build.mjs) i brána „plugin dorazí do
 * sandboxu". V upstreamu žádný adaptér brokeru neleží, takže tady se pravidlo
 * měří přímo, ne až ve forku, který adaptér nese.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOSTS, hostOf } from "../../../scripts/plugins/host.mjs";

describe("source_spec.host", () => {
  test("bez deklarace je host sandbox — existující pluginy nemění chování", () => {
    expect(hostOf({ kind: "data_source", source_spec: { namespace: "a/b", adapter_entry: "x.ts" } })).toBe("sandbox");
    expect(hostOf({ kind: "agent" })).toBe("sandbox");
    expect(hostOf({ source_spec: { host: null } })).toBe("sandbox");
    expect(hostOf(null)).toBe("sandbox");
    expect(hostOf(undefined)).toBe("sandbox");
  });

  test("adaptér brokeru se přihlásí výslovně", () => {
    expect(hostOf({ source_spec: { host: "source-broker" } })).toBe("source-broker");
    expect(hostOf({ source_spec: { host: "sandbox" } })).toBe("sandbox");
  });

  test("⛔ neznámý host je chyba, ne tichý sandbox", () => {
    // Překlep by adaptér brokeru poslal do sandboxového buildu — do pasti,
    // kterou tohle pole zavírá.
    expect(() => hostOf({ source_spec: { host: "source_broker" } })).toThrow(/není známý host/);
    expect(() => hostOf({ source_spec: { host: "" } })).toThrow(/není známý host/);
    expect(() => hostOf({ source_spec: { host: 1 } })).toThrow(/není známý host/);
  });

  test("schéma manifestu zná přesně ty hosty, které zná predikát", () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), "schemas/plugin-manifest.schema.json"), "utf8"));
    const host = schema.properties.source_spec.properties.host;
    expect(host, "source_spec.host ve schématu chybí").toBeDefined();
    expect([...host.enum].sort()).toEqual([...HOSTS].sort());
    expect(host.default).toBe("sandbox");
  });
});
