#!/usr/bin/env node
/**
 * qr.mjs — obsah QR kódu pro nastavení tabletu s hlídačem.
 *
 * Tablet po továrním resetu (6× ťuknout na uvítací obrazovku) načte QR,
 * připojí se k Wi-Fi, stáhne hlídače z `--apk-url`, ověří jeho podpis
 * a udělá z něj správce zařízení. Skript vypíše JSON; obrázek z něj udělá
 * administrace (nebo jakýkoli generátor QR).
 *
 *   HLIDAC_WIFI_PASSWORD=… node apps/hlidac/scripts/qr.mjs \
 *     --instance <fork>-instance-data/zarizeni/hlidac.json \
 *     --apk-url https://…/hlidac.apk [--wifi-ssid Nastaveni --wifi-security WPA] \
 *     [--okno 02:00-04:00]  < pin.txt
 *
 * ⛔ PIN technika se čte ZE STDIN a do QR jde jen jeho otisk (PBKDF2) —
 * nikdy z argumentu (zůstal by v historii shellu) a nikdy v čitelné podobě.
 * Heslo Wi-Fi jen z prostředí, ze stejného důvodu.
 *
 * @module
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDirectRun } from "../../../scripts/lib/cli-entry.mjs";

const ITERACE = 120_000;
/** Třída správce je součást kódu hlídače (namespace platforma.hlidac), balíček patří instanci. */
const TRIDA_SPRAVCE = "platforma.hlidac.SpravceReceiver";

function argumenty(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`nečekaný argument: ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1];
  }
  return a;
}

/** SHA-256 certifikátu (hex s dvojtečkami) → base64url bez zarovnání, jak ho čte ManagedProvisioning. */
export function checksumZOtisku(otisk) {
  const hex = String(otisk).replace(/:/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`signing.certSha256 není SHA-256: ${otisk}`);
  return Buffer.from(hex, "hex").toString("base64url");
}

export function zaznamPinu(pin, sul = randomBytes(16), iterace = ITERACE) {
  if (!/^\d{6,}$/.test(pin)) throw new Error("PIN musí mít aspoň 6 číslic");
  const otisk = pbkdf2Sync(pin, sul, iterace, 32, "sha256");
  return `pbkdf2_sha256$${iterace}$${sul.toString("base64")}$${otisk.toString("base64")}`;
}

/**
 * Výbava pro appku: KAM se připojit a ČÍM se ohlásit u dveří.
 *
 * ⛔ KLÍČE JSOU KONTRAKT s `Vybava.java` — hlídá brána
 * `vybava-hlidace-ma-jeden-kontrakt`. Přejmenování na jedné straně by appku
 * odstřihlo od API a projevilo by se to až u tabletu.
 *
 * ⛔ PORT JDE JAKO ŘETĚZEC. `PersistableBundle` z QR by z čísla udělal int a
 *    čtení druhého tvaru je sice ošetřené, ale jeden tvar na drátě je jeden
 *    tvar k ověření.
 *
 * ⛔ ČÁSTEČNÁ SADA DVEŘÍ = VADA DEKLARACE, ne „bez dveří". Appka by nabídku
 *    klepání skryla a nikdo by se nedozvěděl proč.
 */
export function vybavaDoBundlu(vybava) {
  if (!vybava) return {};
  const p = "platforma.hlidac.";
  const api = String(vybava.apiUrl ?? "").trim();
  if (!api) throw new Error("vybava.apiUrl chybí — appka by neznala adresu platformy");
  if (!/^https?:\/\//.test(api)) throw new Error("vybava.apiUrl musí být http(s) adresa");
  const out = { [`${p}API_URL`]: api };
  const k = vybava.knock;
  if (k === undefined || k === null) return out;
  const chybi = ["host", "port", "kid", "scope"].filter((x) => k[x] === undefined || k[x] === null || k[x] === "");
  if (chybi.length) throw new Error(`vybava.knock je neúplná (chybí: ${chybi.join(", ")}) — buď všechny čtyři, nebo žádná`);
  const port = Number(k.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("vybava.knock.port musí být 1–65535");
  out[`${p}KNOCK_HOST`] = String(k.host);
  out[`${p}KNOCK_PORT`] = String(port);
  out[`${p}KNOCK_KID`] = String(k.kid);
  out[`${p}KNOCK_SCOPE`] = String(k.scope);
  return out;
}

/** Noční okno 00:00–23:59 — týž vzor jako administrace (src/lib/zarizeni/qrHlidace.ts) a server. */
export const OKNO_VZOR = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function obsahQr({ instance, apkUrl, pinZaznam, okno, wifi }) {
  // QR s oknem, které tablet odmítne, se nevydá — jinak by platilo tiše jiné (2026-09-28).
  if (okno !== undefined && !OKNO_VZOR.test(okno)) throw new Error("night window must be HH:MM-HH:MM (00:00–23:59)");
  if (!/^https?:\/\//.test(apkUrl ?? "")) throw new Error("--apk-url musí být http(s) adresa");
  const p = "android.app.extra.";
  const obsah = {
    [`${p}PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME`]: `${instance.applicationId}/${TRIDA_SPRAVCE}`,
    [`${p}PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION`]: apkUrl,
    [`${p}PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM`]: checksumZOtisku(instance.signing?.certSha256),
    // Stahovat i přes mobilní data — tablet se SIM bez Wi-Fi by jinak Kiosk Admina
    // nestáhl (viz src/lib/zarizeni/qrHlidace.ts, 2026-09-29).
    [`${p}PROVISIONING_USE_MOBILE_DATA`]: true,
    // Výbava výrobce zůstane vypnutá; co kiosk potřebuje (Obchod Play,
    // fotoaparát), si hlídač povolí sám.
    [`${p}PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED`]: false,
    [`${p}PROVISIONING_ADMIN_EXTRAS_BUNDLE`]: {
      pin: pinZaznam,
      ...(okno ? { okno } : {}),
      ...vybavaDoBundlu(instance.vybava),
    },
  };
  if (instance.provisioning?.timeZone) obsah[`${p}PROVISIONING_TIME_ZONE`] = instance.provisioning.timeZone;
  if (instance.provisioning?.locale) obsah[`${p}PROVISIONING_LOCALE`] = instance.provisioning.locale;
  if (wifi?.ssid) {
    obsah[`${p}PROVISIONING_WIFI_SSID`] = wifi.ssid;
    obsah[`${p}PROVISIONING_WIFI_SECURITY_TYPE`] = wifi.security ?? "WPA";
    if (wifi.password) obsah[`${p}PROVISIONING_WIFI_PASSWORD`] = wifi.password;
  }
  return obsah;
}

function main() {
  const a = argumenty(process.argv.slice(2));
  if (!a.instance) throw new Error("chybí --instance <hlidac.json>");
  const instance = JSON.parse(readFileSync(a.instance, "utf-8"));
  const pin = readFileSync(0, "utf-8").trim();
  const obsah = obsahQr({
    instance,
    apkUrl: a["apk-url"],
    pinZaznam: zaznamPinu(pin),
    okno: a.okno,
    wifi: a["wifi-ssid"]
      ? { ssid: a["wifi-ssid"], security: a["wifi-security"], password: process.env.HLIDAC_WIFI_PASSWORD }
      : null,
  });
  process.stdout.write(`${JSON.stringify(obsah)}\n`);
}

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`⛔ ${e.message}`);
    process.exit(1);
  }
}
