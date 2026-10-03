/**
 * Brána: forwarder mesh DNS je DEKLARACE INSTANCE, ne resolver stroje, odkud se nasazuje.
 *
 * ⛔ NAMĚŘENO 2026-09-16 na guru. Fáze F cold-startu brala forwarder z
 * `/etc/resolv.conf` stroje, na kterém běží — z notebooku operátora. V kanceláři to
 * náhodou sedělo (týž resolver LAN jako servery), na hotspotu by do NetBirdu zapsala
 * `fe80::…%en0`. Kontejnery ukázané na mesh resolver by nepřeložily žádné veřejné
 * jméno a nic by to nehlásilo.
 *
 * CO SE MĚŘÍ:
 *   1. cold-start forwarder nečte ze souboru resolveru stroje,
 *   2. netbird-dns-provision nemá náhradní klíč a bez platného forwarderu nezapíše,
 *   3. doktor forwarder ověřuje touž knihovnou a klíč je v kontraktu env-doktora.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const kod = (sh: string) => sh.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

/** Vrátí řádky kódu, které forwarder skládají ze souboru resolveru stroje. */
export function forwarderZeStroje(sh: string): string[] {
  return kod(sh)
    .split("\n")
    .filter((r) => /_fwd_ip=/.test(r) && /resolv\.conf/.test(r));
}

describe("mesh DNS forwarder je deklarace instance", () => {
  test("1. cold-start ho nečte z /etc/resolv.conf stroje", () => {
    expect(forwarderZeStroje(cti("scripts/aisha-cold-start.sh"))).toEqual([]);
    expect(kod(cti("scripts/aisha-cold-start.sh"))).toMatch(/_fwd_ip="\$\{NETBIRD_DNS_FORWARD_IP:-\}"/);
  });

  test("1b. sonda jde rozsvítit — původní tvar by chytila", () => {
    const stary = `_fwd_ip="$(awk '/^nameserver/ {print $2}' /etc/resolv.conf 2>/dev/null | grep -vE '^127\\.' | head -1)"`;
    expect(forwarderZeStroje(stary)).toHaveLength(1);
  });

  test("2. netbird-dns-provision: jeden klíč, ověření knihovnou, bez forwarderu se nezapisuje", () => {
    const js = cti("scripts/netbird-dns-provision.mjs");
    expect(js, "náhradní klíč HOST_DNS_RESOLVER se vrátil").not.toMatch(/HOST_DNS_RESOLVER/);
    expect(js).toMatch(/overForwarder\(env\.NETBIRD_DNS_FORWARD_IP\)/);
    const iApply = js.indexOf('if (!APPLY) { console.log("\\n(DRY-RUN');
    const iStop = js.indexOf("if (!FORWARDER.ok) {");
    expect(iStop, "bez platného forwarderu musí zápis skončit").toBeGreaterThan(iApply);
  });

  test("3. doktor ověřuje touž knihovnou a env-doktor klíč zná", () => {
    expect(cti("scripts/cold-start-doctor.sh")).toMatch(/scripts\/lib\/dns-forwarder\.mjs/);
    expect(cti("scripts/aisha-env-doctor.mjs")).toMatch(/\["NETBIRD_DNS_FORWARD_IP", "static", ""\]/);
  });
});
