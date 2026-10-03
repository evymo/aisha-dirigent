/**
 * Zamčené úložiště — a hlavně tři místa, kde by se dala ztratit práce řidiče.
 */
import crypto from "node:crypto";
import { TrezorNecitelny, jeZamceno, type TrezorCrypto } from "@/lib/trezor";
import { _zapomenKlic, precti, prectiAMigruj, smaz, zapis, type TrezorStoreDeps } from "@/services/trezorStore";

const nodeCrypto: TrezorCrypto = {
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  encrypt: (key, iv, plaintext, aad) => {
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]);
    return { ciphertext: new Uint8Array(ct), tag: new Uint8Array(c.getAuthTag()) };
  },
  decrypt: (key, iv, ciphertext, tag, aad) => {
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag));
    return new Uint8Array(Buffer.concat([d.update(Buffer.from(ciphertext)), d.final()]));
  },
};

/** Disk a trezor telefonu jako obyčejné mapy — vidíme tak, co na disku LEŽÍ. */
function deps() {
  const disk = new Map<string, string>();
  const secure = new Map<string, string>();
  const d: TrezorStoreDeps = {
    crypto: nodeCrypto,
    getItem: async (k) => disk.get(k) ?? null,
    removeItem: async (k) => { disk.delete(k); },
    secureGet: async (k) => secure.get(k) ?? null,
    secureSet: async (k, v) => { secure.set(k, v); },
    setItem: async (k, v) => { disk.set(k, v); },
  };
  return { d, disk, secure };
}

const FRONTA = "aisha_offline_queue";
const PRACE = JSON.stringify([{ id: "s1", payload: { recipient: "Jana Nováková", signature: "data:image/png;base64,AAAA" } }]);

beforeEach(() => _zapomenKlic());

describe("na disku neleží nic čitelného", () => {
  it("zápis zamkne — jméno ani podpis na disku nejsou", async () => {
    const { d, disk } = deps();
    await zapis(d, FRONTA, PRACE);
    const naDisku = disk.get(FRONTA)!;
    expect(naDisku).not.toContain("Nováková");
    expect(naDisku).not.toContain("data:image");
    expect(jeZamceno(naDisku)).toBe(true);
  });

  it("co se zapsalo, jde přečíst", async () => {
    const { d } = deps();
    await zapis(d, FRONTA, PRACE);
    expect((await precti(d, FRONTA))!.text).toBe(PRACE);
  });

  it("prázdná schránka je null, ne prázdný řetězec", async () => {
    const { d } = deps();
    expect(await precti(d, FRONTA)).toBeNull();
  });

  it("klíč leží v SecureStore, ne na disku", async () => {
    const { d, disk, secure } = deps();
    await zapis(d, FRONTA, PRACE);
    expect(secure.size).toBe(1);
    expect([...disk.values()].join()).not.toContain([...secure.values()][0]);
  });
});

describe("upgrade appky nesmí zahodit rozdělanou práci", () => {
  it("plaintext ze staršího buildu se přečte a označí jako legacy", async () => {
    const { d, disk } = deps();
    disk.set(FRONTA, PRACE); // tak to na telefonu leželo před šifrováním
    const p = await precti(d, FRONTA);
    expect(p).toEqual({ legacy: true, text: PRACE });
  });

  /**
   * ⭐ POŘADÍ JE CELÁ MIGRACE: zapiš zamčené → tím je hotovo. Kdyby se plaintext
   * mazal zvlášť a předtím, je mezi kroky okamžik, ve kterém pád appky sebere
   * řidiči podepsané předání.
   */
  it("migrace zamkne obsah a NIC mezitím nezmizí", async () => {
    const { d, disk } = deps();
    disk.set(FRONTA, PRACE);
    const p = await prectiAMigruj(d, FRONTA);
    expect(p!.legacy).toBe(true);
    expect(jeZamceno(disk.get(FRONTA)!)).toBe(true);
    expect((await precti(d, FRONTA))!.text).toBe(PRACE);
  });

  it("už zamčený obsah se migrací nedotkne", async () => {
    const { d, disk } = deps();
    await zapis(d, FRONTA, PRACE);
    const pred = disk.get(FRONTA);
    expect((await prectiAMigruj(d, FRONTA))!.legacy).toBe(false);
    expect(disk.get(FRONTA)).toBe(pred);
  });
});

describe("nečitelné se NEPŘEPISUJE a neslije s prázdnem", () => {
  it("ztracený klíč = výjimka, obsah na disku ZŮSTÁVÁ", async () => {
    const { d, disk, secure } = deps();
    await zapis(d, FRONTA, PRACE);
    const zamceno = disk.get(FRONTA);
    secure.clear();          // obnova systému / přeinstalace
    _zapomenKlic();
    await expect(precti(d, FRONTA)).rejects.toThrow(TrezorNecitelny);
    // ⛔ Kdyby se tu vyrobil nový klíč a přepsalo, ztráta by byla TRVALÁ.
    expect(disk.get(FRONTA)).toBe(zamceno);
  });

  it("poškozený klíč v SecureStore raději spadne, než vyrobí nový", async () => {
    const { d, secure } = deps();
    await zapis(d, FRONTA, PRACE);
    _zapomenKlic();
    secure.set("aisha_trezor_key_v1", Buffer.from("moc kratky").toString("base64"));
    await expect(precti(d, FRONTA)).rejects.toThrow(/32/);
  });

  it("smazat jde jen výslovně", async () => {
    const { d, disk } = deps();
    await zapis(d, FRONTA, PRACE);
    await smaz(d, FRONTA);
    expect(disk.has(FRONTA)).toBe(false);
  });
});

describe("klíč vzniká právě jednou", () => {
  /**
   * ⛔ Kdyby se cachovala hodnota místo slibu, dvě souběžná volání by obě minula
   * prázdnou cache, obě vyrobila klíč, druhé přepsalo první — a co bylo zamčené
   * tím prvním, by už nikdo neotevřel.
   */
  it("dva souběžné zápisy nevyrobí dva klíče", async () => {
    const { d, secure } = deps();
    await Promise.all([zapis(d, "a", "1"), zapis(d, "b", "2")]);
    expect(secure.size).toBe(1);
    expect((await precti(d, "a"))!.text).toBe("1");
    expect((await precti(d, "b"))!.text).toBe("2");
  });

  it("neúspěch se necachuje — jedna chyba nezamkne úložiště do restartu", async () => {
    const { d, secure } = deps();
    let selhat = true;
    const rozbity: TrezorStoreDeps = {
      ...d,
      secureGet: async (k) => { if (selhat) throw new Error("keychain zaneprázdněn"); return secure.get(k) ?? null; },
    };
    await expect(zapis(rozbity, FRONTA, PRACE)).rejects.toThrow(/keychain/);
    selhat = false;
    await expect(zapis(rozbity, FRONTA, PRACE)).resolves.toBeUndefined();
  });
});
