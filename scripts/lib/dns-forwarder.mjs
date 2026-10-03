/**
 * dns-forwarder.mjs — kam posílá mesh DNS resolver (NetBird) veřejná jména.
 *
 * ⛔ NAMĚŘENO 2026-09-16 na guru. Cold-start bral forwarder z `/etc/resolv.conf`
 * STROJE, NA KTERÉM BĚŽÍ — tedy z notebooku operátora. V kanceláři to náhodou
 * sedělo (resolver LAN je týž jako na serverech), na hotspotu by
 * do NetBirdu zapsal `fe80::…%en0` (link-local, zevnitř kontejneru nedosažitelný)
 * nebo resolver telefonu. Kontejnery ukázané na mesh resolver by pak nepřeložily
 * žádné veřejné jméno (stažení vah modelu, API poskytovatelů) — a nic by to
 * nehlásilo jako chybu DNS.
 *
 * Forwarder je proto DEKLARACE INSTANCE (`NETBIRD_DNS_FORWARD_IP` v záloze
 * instance): resolver sítě, ve které stojí servery. Nehádá se ze stroje, odkud
 * se nasazuje. Adresa, která z kontejneru na serveru dosažitelná být nemůže
 * (loopback, link-local, s identifikátorem zóny), se odmítne nahlas.
 */
import { isIP } from "node:net";

/** @returns {{ ok: true, ip: string } | { ok: false, duvod: string }} */
export function overForwarder(hodnota) {
  const ip = String(hodnota ?? "").trim();
  if (!ip) {
    return { ok: false, duvod: "NETBIRD_DNS_FORWARD_IP není deklarovaná — resolver sítě serverů patří do zálohy instance (.env-prod-backup)" };
  }
  if (ip.includes("%")) {
    return { ok: false, duvod: `${ip}: adresa s identifikátorem zóny je vázaná na rozhraní stroje, ne na síť serverů` };
  }
  const verze = isIP(ip);
  if (verze === 0) return { ok: false, duvod: `${ip}: není IP adresa` };
  if (verze === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return { ok: false, duvod: `${ip}: loopback — NetBird agent na něj z kontejneru nedosáhne` };
    if (a === 169 && b === 254) return { ok: false, duvod: `${ip}: link-local — mimo vlastní segment nedosažitelná` };
    if (a === 0) return { ok: false, duvod: `${ip}: neplatná adresa` };
  } else {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return { ok: false, duvod: `${ip}: loopback/nespecifikovaná adresa` };
    if (/^fe[89ab][0-9a-f]:/.test(v)) return { ok: false, duvod: `${ip}: link-local — mimo vlastní segment nedosažitelná` };
  }
  return { ok: true, ip };
}
