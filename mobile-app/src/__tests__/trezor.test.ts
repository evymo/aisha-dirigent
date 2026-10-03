/**
 * Trezor — co leží na disku telefonu, leží zamčené.
 *
 * ⭐ KRYPTO JE SKUTEČNÉ, NE ATRAPA. `TrezorCrypto` se injektuje, takže sem jde
 * dosadit AES-256-GCM z Node. Atrapa by ověřila, že se volají správné funkce,
 * ale ne že to, co vyleze, je opravdu nečitelné a ověřené — a právě to je celé
 * tvrzení tohohle modulu.
 */
import crypto from "node:crypto";
import {
  IV_BYTES, KEY_BYTES, TrezorNecitelny, jeZamceno, novyKlic, rozsifruj, zasifruj,
  type TrezorCrypto,
} from "@/lib/trezor";

/** Tentýž algoritmus, jaký na telefonu dodá quick-crypto. */
const nodeCrypto: TrezorCrypto = {
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  encrypt: (key, iv, plaintext, aad) => {
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]);
    return { ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(c.getAuthTag()) };
  },
  decrypt: (key, iv, ciphertext, tag, aad) => {
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag));
    return new Uint8Array(Buffer.concat([d.update(Buffer.from(ciphertext)), d.final()]));
  },
};

const KLIC = novyKlic(nodeCrypto);
const ULOZKA = "aisha_offline_queue";

/** Co v té frontě doopravdy leží — podpis přejímajícího a jeho jméno. */
const PRACE = JSON.stringify([{
  id: "step:abc:2026-08-19T10:00:00Z",
  payload: {
    recipient: "Jana Nováková",
    signature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    note: "Paleta 3 poškozená",
  },
}]);

describe("trezor — co je na disku, není čitelné", () => {
  it("zamčený obsah neprozradí ani jméno, ani podpis", () => {
    const obalka = zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE);
    expect(obalka).not.toContain("Nováková");
    expect(obalka).not.toContain("data:image");
    expect(obalka).not.toContain("poškozená");
    expect(jeZamceno(obalka)).toBe(true);
  });

  it("co se zamklo, jde odemknout beze změny", () => {
    expect(rozsifruj(nodeCrypto, KLIC, ULOZKA, zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE))).toBe(PRACE);
  });

  it("dvakrát totéž dá JINOU obálku — IV se neopakuje", () => {
    expect(zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE)).not.toBe(zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE));
  });

  it("prázdný řetězec je platný obsah, ne chybějící", () => {
    expect(rozsifruj(nodeCrypto, KLIC, ULOZKA, zasifruj(nodeCrypto, KLIC, ULOZKA, ""))).toBe("");
  });
});

describe("trezor — prázdno × NEČITELNO se nesmí slít", () => {
  /**
   * ⛔ TOHLE JE CELÝ DŮVOD, PROČ `rozsifruj` VYHAZUJE. Šifrování přidalo nový
   * způsob, jak ztratit práci řidiče: ztracený klíč. `try/catch → return []`
   * by vyrobil vadu z PR #154 na novém místě — appka by tvrdila „nic nemáš"
   * nad podepsaným předáním, které jen nejde přečíst.
   */
  it("cizí klíč = NEČITELNO (výjimka), nikdy prázdno", () => {
    const obalka = zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE);
    const cizi = novyKlic(nodeCrypto);
    expect(() => rozsifruj(nodeCrypto, cizi, ULOZKA, obalka)).toThrow(TrezorNecitelny);
  });

  it("porušený bajt = NEČITELNO, ne tichý odpad", () => {
    const obalka = zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE);
    const casti = obalka.split(".");
    casti[3] = Buffer.from("uplne jina data").toString("base64");
    expect(() => rozsifruj(nodeCrypto, KLIC, ULOZKA, casti.join("."))).toThrow(TrezorNecitelny);
  });

  it("useknutá obálka = NEČITELNO", () => {
    expect(() => rozsifruj(nodeCrypto, KLIC, ULOZKA, "v1.abc.def")).toThrow(TrezorNecitelny);
  });

  /**
   * AAD váže obálku ke JMÉNU ÚLOŽIŠTĚ: přesunout zálohu fronty na místo cache
   * nejde. Bez toho by šlo obsah zaměnit, aniž by se šifrování porušilo.
   */
  it("obálku nejde přenést pod jiné úložiště", () => {
    const obalka = zasifruj(nodeCrypto, KLIC, ULOZKA, PRACE);
    expect(() => rozsifruj(nodeCrypto, KLIC, "aisha_query_cache", obalka)).toThrow(TrezorNecitelny);
  });
});

describe("trezor — upgrade appky nesmí zahodit rozdělanou práci", () => {
  /**
   * Na telefonech, které frontu naplnily před šifrováním, leží plaintext.
   * Kdyby ho `rozsifruj` odmítl, upgrade appky by řidiči smazal podepsaná
   * předání — tedy přesně to, čemu celá tahle vrstva brání.
   */
  it("plaintext ze staršího buildu se přečte beze změny", () => {
    expect(rozsifruj(nodeCrypto, KLIC, ULOZKA, PRACE)).toBe(PRACE);
    expect(jeZamceno(PRACE)).toBe(false);
  });

  it("rozhoduje PREFIX, ne pokus o rozšifrování", () => {
    // Kdyby se plaintext poznával „zkusím a když to spadne", udělal by porušený
    // šifrotext text a fronta by parsovala náhodné bajty.
    expect(jeZamceno("v1.a.b.c")).toBe(true);
    expect(jeZamceno("[{\"id\":\"x\"}]")).toBe(false);
    expect(jeZamceno("")).toBe(false);
  });
});

describe("trezor — parametry, na kterých to stojí", () => {
  it("klíč špatné délky se odmítne PŘI ZÁMKU, ne až při čtení", () => {
    expect(() => zasifruj(nodeCrypto, new Uint8Array(16), ULOZKA, "x")).toThrow(/32/);
  });

  it("klíč je 256bitový a IV 96bitový", () => {
    expect(novyKlic(nodeCrypto)).toHaveLength(KEY_BYTES);
    expect(KEY_BYTES).toBe(32);
    expect(IV_BYTES).toBe(12);
  });
});
