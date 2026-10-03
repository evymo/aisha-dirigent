/**
 * Úložiště na disku telefonu, ale zamčené — obálka nad `AsyncStorage`.
 *
 * ⛔ CO SE TU CHRÁNÍ. Offline fronta nese jméno přejímajícího, jeho PODPIS,
 * poznámky a cesty k fotkám. To jsou osobní údaje TŘETÍ osoby a zároveň právní
 * důkaz pro fakturaci. Do 2026-08-19 ležely v plaintextu, zatímco tokeny mířily
 * do SecureStore — chránili jsme klíč od domu a nechali na stole podepsaný
 * papír.
 *
 * ## Tři pravidla, na kterých to stojí
 *
 * ⭐ 1. NEČITELNÉ SE NEPŘEPISUJE. Kdo neumí přečíst, nesmí zapsat — přepis by
 * z dočasné nečitelnosti (chybí klíč, jiný profil) udělal TRVALOU ztrátu. Proto
 * `precti` vyhazuje a `zapis` se v té větvi vůbec nezavolá.
 *
 * ⭐ 2. PLAINTEXT ZE STARŠÍHO BUILDU SE PŘEČTE a ohlásí se jako legacy. Migrace
 * je pak VĚDOMÝ krok volajícího v pořadí „zapiš zamčené → teprve pak je hotovo",
 * nikdy „smaž staré → zapiš nové": mezi těmi dvěma kroky je okamžik, ve kterém
 * pád appky sebere řidiči podepsané předání.
 *
 * ⭐ 3. KLÍČ VZNIKÁ PRÁVĚ JEDNOU. Dva souběžné zápisy by jinak vyrobily dva
 * klíče, jeden by vyhrál a data zamčená tím druhým by byla nenávratně pryč.
 * Proto se drží rozdělaný slib, ne hodnota.
 *
 * @module
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { KEY_BYTES, b64, jeZamceno, rozsifruj, zasifruj, type TrezorCrypto } from "@/lib/trezor";

/**
 * Klíč trezoru bydlí tam, kde tokeny — v hardwarem chráněném úložišti.
 *
 * ⭐ TOHLE NENÍ TAJEMSTVÍ, je to JMÉNO PŘIHRÁDKY. Pod tímhle řetězcem leží
 * v SecureStore skutečný klíč; sám o sobě neotevře nic a je stejně veřejný
 * jako název souboru. `gitleaks` ho hlásí kvůli pravidlu `generic-api-key`,
 * které se chytá na tvar `*_KEY = "…"` — proto výjimka NA TOMHLE JEDNOM
 * ŘÁDKU, ne v konfiguraci skeneru: vypnout pravidlo globálně by znamenalo
 * přestat hlídat i skutečné klíče.
 */
// gitleaks:allow — jméno slotu v SecureStore, ne pověření
const KLIC_KEY = "aisha_trezor_key_v1";

/** Co `precti` vrátí. `legacy` = přečteno z plaintextu staršího buildu. */
export interface Precteno {
  text: string;
  legacy: boolean;
}

/** Platformní závislosti. Injektují se, aby šlo úložiště testovat bez zařízení. */
export interface TrezorStoreDeps {
  crypto: TrezorCrypto;
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
  secureGet(k: string): Promise<string | null>;
  secureSet(k: string, v: string): Promise<void>;
}

/**
 * Rozdělaný slib o klíči, ne klíč sám.
 *
 * ⛔ Kdyby se cachovala až HODNOTA, dvě souběžná volání by obě minula prázdnou
 * cache, obě by vyrobila klíč a to druhé by přepsalo první — data zamčená tím
 * prvním by pak nešla otevřít. Slib se sdílí od prvního volání.
 */
let rozdelanyKlic: Promise<Uint8Array> | null = null;

/** JEN PRO TESTY: zapomene rozdělaný slib, aby šlo měřit i vznik klíče. */
export function _zapomenKlic(): void {
  rozdelanyKlic = null;
}

async function klic(d: TrezorStoreDeps): Promise<Uint8Array> {
  if (!rozdelanyKlic) {
    rozdelanyKlic = (async () => {
      const ulozeny = await d.secureGet(KLIC_KEY);
      if (ulozeny) {
        const bajty = b64.dec(ulozeny);
        // Poškozený klíč NESMÍ vyrobit nový: tím by se zahodilo všechno, co jím
        // bylo zamčené. Radši hlasitě spadnout než tiše ztratit.
        if (bajty.length !== KEY_BYTES) {
          throw new Error(`trezor: uložený klíč má ${bajty.length} B, čekám ${KEY_BYTES}`);
        }
        return bajty;
      }
      const novy = d.crypto.randomBytes(KEY_BYTES);
      await d.secureSet(KLIC_KEY, b64.enc(novy));
      return novy;
    })().catch((e) => {
      // Neúspěch se NECACHUJE — jinak by jedna chyba zamkla úložiště do restartu.
      rozdelanyKlic = null;
      throw e;
    });
  }
  return rozdelanyKlic;
}

/**
 * Přečte zamčenou hodnotu.
 *
 * `null` = ve schránce nic není (legitimní prázdno). Nečitelný obsah VYHAZUJE
 * `TrezorNecitelny` — „nic tam není" a „neumím to přečíst" jsou dva různé stavy
 * a jejich slití je ta vada, kvůli které řidičům mizela práce.
 */
export async function precti(d: TrezorStoreDeps, jmeno: string): Promise<Precteno | null> {
  const raw = await d.getItem(jmeno);
  if (raw === null) return null;
  const zamceno = jeZamceno(raw);
  return { legacy: !zamceno, text: rozsifruj(d.crypto, await klic(d), jmeno, raw) };
}

/** Zamkne a uloží. */
export async function zapis(d: TrezorStoreDeps, jmeno: string, text: string): Promise<void> {
  await d.setItem(jmeno, zasifruj(d.crypto, await klic(d), jmeno, text));
}

/** Smaže schránku. Mazat smí jen ten, kdo ví, co maže — viz volající. */
export async function smaz(d: TrezorStoreDeps, jmeno: string): Promise<void> {
  await d.removeItem(jmeno);
}

/**
 * Přečte a rovnou zamkne, co bylo v plaintextu.
 *
 * ⭐ POŘADÍ JE CELÁ MIGRACE: nejdřív se zapíše zamčená verze a teprve tím je
 * hotovo. Kdyby se plaintext mazal zvlášť a předtím, byl by mezi těmi dvěma
 * kroky okamžik, ve kterém pád appky sebere řidiči podepsané předání.
 * `setItem` na TÉŽ jméno je přepis, takže žádné mazání navíc není potřeba.
 */
export async function prectiAMigruj(d: TrezorStoreDeps, jmeno: string): Promise<Precteno | null> {
  const p = await precti(d, jmeno);
  if (p?.legacy) await zapis(d, jmeno, p.text);
  return p;
}

/** Ostrá platformní vazba. Krypto přichází zvenčí, ať tenhle soubor nelinkuje nativní kód. */
export function nativeDeps(crypto: TrezorCrypto): TrezorStoreDeps {
  return {
    crypto,
    getItem: (k) => AsyncStorage.getItem(k),
    removeItem: (k) => AsyncStorage.removeItem(k),
    secureGet: (k) => SecureStore.getItemAsync(k),
    /**
     * ⛔ `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — klíč se NIKDY nepřenese na jiné
     * zařízení ani do zálohy. Pár s `android.allowBackup: false`: šifrotext se
     * ven dostat může, klíč ne, a bez klíče je záloha k ničemu.
     *
     * ⚠️ Důsledek je skutečný, ne teoretický: po přenosu na nový telefon je
     * fronta NEČITELNÁ. Je to vědomá cena za to, že podpis třetí osoby neleží
     * v cizí záloze — a je to přesně ten stav, který appka umí rozlišit od
     * prázdna a nikdy ho nepřepíše.
     */
    secureSet: (k, v) =>
      SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
  };
}
