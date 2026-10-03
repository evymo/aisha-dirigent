/**
 * QR z administrace = QR ze skriptu. Dva zdroje téhož obsahu se jinak rozejdou
 * při první změně a tablet nastavený z jednoho by druhý nepoznal.
 */
import { describe, it, expect } from "vitest";
import { zaznamPinu, obsahQr, platneOkno, OKNO_VZOR } from "./qrHlidace";
// Skutečný výstup skriptu, ne kopie jeho logiky.
import { zaznamPinu as zaznamPinuSkript, obsahQr as obsahQrSkript, OKNO_VZOR as OKNO_VZOR_SKRIPT } from "../../../apps/hlidac/scripts/qr.mjs";

const SUL = Uint8Array.from(Buffer.from("00112233445566778899aabbccddeeff", "hex"));
const OTISK = "4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00";

describe("QR hlídače v administraci", () => {
  it("otisk PINu z WebCrypto = otisk z Node skriptu = vektor, který ověřuje Pin.java", async () => {
    const web = await zaznamPinu("482915", SUL, 100_000);
    expect(web).toBe("pbkdf2_sha256$100000$ABEiM0RVZneImaq7zN3u/w==$lXicz2eTouSl5ISTomYpPagp2SGheK85nUeMCJ3hxrc=");
    expect(web).toBe(zaznamPinuSkript("482915", Buffer.from(SUL), 100_000));
  });

  it("krátký PIN se odmítne", async () => {
    await expect(zaznamPinu("1234")).rejects.toThrow(/6 digits/);
  });

  it("obsah QR je bajt po bajtu tentýž jako ze skriptu", () => {
    const pin = "pbkdf2_sha256$120000$c3Vs$b3Rpc2s=";
    const web = obsahQr({
      konfigurace: {
        applicationId: "com.example.hlidac",
        checksum: "S26cPpDeK52_dl2yso-ypyBa-yOzk-perBNcf76KKAA",
        spravce: "com.example.hlidac/platforma.hlidac.SpravceReceiver",
        timeZone: "Europe/Prague",
        locale: "cs_CZ",
      },
      stazeni: "https://api.example.test/storage/v1/zarizeni/hlidac.apk",
      pinZaznam: pin,
      okno: "01:00-03:00",
      wifi: { ssid: "Nastaveni", heslo: "tajne", zabezpeceni: "WPA" },
    });
    const skript = obsahQrSkript({
      instance: {
        applicationId: "com.example.hlidac",
        signing: { certSha256: OTISK },
        provisioning: { timeZone: "Europe/Prague", locale: "cs_CZ" },
      },
      apkUrl: "https://api.example.test/storage/v1/zarizeni/hlidac.apk",
      pinZaznam: pin,
      okno: "01:00-03:00",
      wifi: { ssid: "Nastaveni", security: "WPA", password: "tajne" },
    });
    expect(JSON.stringify(web)).toBe(JSON.stringify(skript));
  });

  it("⛔ tablet se SIM bez Wi-Fi stáhne Kiosk Admin přes mobilní data (2026-09-29)", () => {
    const obsah = obsahQr({
      konfigurace: { applicationId: "com.example.hlidac", checksum: "x", spravce: "com.example.hlidac/platforma.hlidac.SpravceReceiver" },
      stazeni: "https://api.example.test/storage/v1/zarizeni/hlidac.apk",
      pinZaznam: "pbkdf2_sha256$120000$c3Vs$b3Rpc2s=",
    });
    expect(obsah["android.app.extra.PROVISIONING_USE_MOBILE_DATA"]).toBe(true);
    // Bez Wi-Fi v QR se Wi-Fi klíče neobjeví — tablet jede jen přes mobilní data.
    expect(Object.keys(obsah).some((k) => k.includes("WIFI"))).toBe(false);
  });

  it("⛔ noční okno: 00:00–23:59, jinak QR nevznikne — administrace i skript stejně (2026-09-28: „24:00“)", () => {
    expect(OKNO_VZOR.source).toBe(OKNO_VZOR_SKRIPT.source);
    for (const ok of ["02:00-04:00", "00:00-23:59", "22:30-01:15"]) expect(platneOkno(ok)).toBe(true);
    for (const vadne of ["22:00-24:00", "2:00-4:00", "02:00–04:00", "25:00-01:00", "02:60-03:00", ""]) expect(platneOkno(vadne)).toBe(false);
    const zaklad = {
      konfigurace: { applicationId: "com.example.hlidac", checksum: "x", spravce: "com.example.hlidac/platforma.hlidac.SpravceReceiver", timeZone: "Europe/Prague", locale: "cs_CZ" },
      stazeni: "https://api.example.test/storage/v1/zarizeni/hlidac.apk",
      pinZaznam: "pbkdf2_sha256$120000$c3Vs$b3Rpc2s=",
    };
    expect(() => obsahQr({ ...zaklad, okno: "22:00-24:00" })).toThrow(/night window/);
    expect(() => obsahQrSkript({ instance: { applicationId: "com.example.hlidac", signing: { certSha256: OTISK }, provisioning: {} }, apkUrl: zaklad.stazeni, pinZaznam: zaklad.pinZaznam, okno: "22:00-24:00" })).toThrow(/night window/);
  });
});
