/**
 * Nativní krypto a UDP — JEDINÉ místo v appce, které je linkuje.
 *
 * Odsud a nikam jinam: `react-native-quick-crypto` a `react-native-udp`. Čistá
 * logika (`knock.ts`, `trezor.ts`) o těchhle modulech neví — proto tentýž kód
 * běží v testu i na telefonu a proto jest neimportuje nativní C++. Tenhle
 * soubor se do jestu netahá.
 *
 * ⭐ SLOUŽÍ TŘEM KONZUMENTŮM (od 2026-09-09) a je to vědomé:
 *   · `nativeKnockDeps()` — klepání na dveře (HMAC, scrypt, náhoda, datagram),
 *   · `nativeTrezorCrypto()` — zámek na obsah, který leží na disku (AES-256-GCM),
 *   · `nativeKryptoZarizeni()` + `nativeUlozisteKlicu()` — průkaz ZAŘÍZENÍ (VER 2).
 * Druhý soubor s `import qc from 'react-native-quick-crypto'` by rozbil právě
 * to, co hlavička slibuje: jedno místo, kde se nativní krypto linkuje. Jméno
 * souboru je tím pádem užší než jeho role — přejmenování je vlastní úklid,
 * roztržení invariantu by byla vada.
 */
import dgram from 'react-native-udp';
import qc from 'react-native-quick-crypto';
import * as SecureStore from 'expo-secure-store';
import type { KnockDeps } from './knock';
import type { TrezorCrypto } from './trezor';
import type { KryptoZarizeni, UlozisteKlicu } from './poverovani-zarizeni';
import { nactiPovereni, povereniZarizeni, zapomenZarizeni, type PovereniZarizeni } from './poverovani-zarizeni';
// ⚠️ Buffer OD KNIHOVNY, ne globální. `setAAD`/`setAuthTag` v quick-cryptu berou
// `Buffer` z `@craftzdog/react-native-buffer` a nemají volnější přetížení jako
// `update()`. S globálním Bufferem to neprojde typovou kontrolou — a kdyby to
// někdo „opravil" castem, zůstala by tu záměna dvou různých Bufferů skrytá.
import { Buffer as RNBuffer } from '@craftzdog/react-native-buffer';
import { getBackendUrl } from '@/config/api';
import type { TabletDeps } from './ohlaseniTabletu';
import { vytvorZdrojRelace, type ZdrojRelace } from './relaceTabletu';

/**
 * Adaptér na nativní moduly telefonu.
 *
 * Sem a NIKAM JINAM patří platformní závislosti: `react-native-quick-crypto`
 * (HMAC-SHA256 a náhoda) a `react-native-udp` (datagram). Protokol sám o nich
 * neví — proto tentýž kód běží v kontejneru i tady.
 */
export function nativeKnockDeps(): KnockDeps {
  return {
    crypto: {
      hmacSha256: (key: Uint8Array, msg: Uint8Array): Uint8Array =>
        new Uint8Array(qc.createHmac("sha256", RNBuffer.from(key)).update(RNBuffer.from(msg)).digest()),
      randomBytes: (n: number): Uint8Array => new Uint8Array(qc.randomBytes(n)),
      // scrypt pro KÓD ČLOVĚKA. quick-crypto ho MÁ (starý komentář v jádru, že
      // „scrypt v RN není", byl obsoletní). `maxmem` musí projít z KDF: výchozí
      // strop quick-crypto je 32 MB a náš profil ho na telefonu překročí, takže
      // bez zvednutí by odvození SPADLO — právě proto je maxmem parametr, ne
      // konstanta skrytá v jádru.
      scryptSync: (password, salt, length, opts): Uint8Array =>
        new Uint8Array(
          qc.scryptSync(RNBuffer.from(password), RNBuffer.from(salt), length, {
            N: opts.N,
            r: opts.r,
            p: opts.p,
            maxmem: opts.maxmem,
          }),
        ),
    },
    // UDP je „poslat a zapomenout": socket se otevře, odešle a hned zavře.
    // Držet ho otevřený by nic nepřineslo — odpověď nepřijde ani přijít nemá.
    sendDatagram: (bytes, host, port) =>
      new Promise<void>((resolve, reject) => {
        const sock = dgram.createSocket({ type: 'udp4' });
        sock.once('error', (e: Error) => { try { sock.close(); } catch { /* už zavřený */ } reject(e); });
        sock.bind(0, () => {
          sock.send(RNBuffer.from(bytes), 0, bytes.length, port, host, (err?: Error) => {
            try { sock.close(); } catch { /* už zavřený */ }
            if (err) reject(err);
            else resolve();
          });
        });
      }),
    nowSec: () => Math.floor(Date.now() / 1000),
  };
}

/**
 * AES-256-GCM pro trezor — zámek na frontu a cache, které leží v `AsyncStorage`.
 *
 * ⚠️ `setAAD` se MUSÍ volat před `update`, jinak ho GCM do ověření nezahrne a
 * vazba obálky na jméno úložiště by tiše neplatila — šifrování by fungovalo
 * a jedna z jeho záruk ne.
 *
 * ⛔ Dešifrování NIC NEODCHYTÁVÁ. `final()` vyhodí, když `authTag` nesedí, a
 * přesně to je žádoucí: `trezor.rozsifruj` z toho udělá `TrezorNecitelny`
 * a volající to musí vyslovit. Ticho tady by znamenalo appku, která nad
 * nečitelnou frontou tvrdí „nic nemáš".
 */
export function nativeTrezorCrypto(): TrezorCrypto {
  return {
    randomBytes: (n: number): Uint8Array => new Uint8Array(qc.randomBytes(n)),

    encrypt: (key, iv, plaintext, aad) => {
      const c = qc.createCipheriv('aes-256-gcm', RNBuffer.from(key), RNBuffer.from(iv));
      c.setAAD(RNBuffer.from(aad));
      const ciphertext = RNBuffer.concat([c.update(RNBuffer.from(plaintext)), c.final()]);
      return { ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(c.getAuthTag()) };
    },

    decrypt: (key, iv, ciphertext, tag, aad) => {
      const d = qc.createDecipheriv('aes-256-gcm', RNBuffer.from(key), RNBuffer.from(iv));
      d.setAAD(RNBuffer.from(aad));
      d.setAuthTag(RNBuffer.from(tag));
      return new Uint8Array(RNBuffer.concat([d.update(RNBuffer.from(ciphertext)), d.final()]));
    },
  };
}

/**
 * Úložiště průkazu zařízení — Keychain (iOS) / Keystore (Android).
 *
 * ⛔ `WHEN_UNLOCKED_THIS_DEVICE_ONLY` je tu z JINÉHO důvodu než u trezoru.
 * U trezoru jde o obsah; tady jde o IDENTITU. Klíč, který se zálohou přenese na
 * druhý telefon, znamená DVĚ zařízení pod jedním schválením — a správce v
 * administraci vidí pořád jednu položku. Odvolání by pak vyřadilo obě, nebo ani
 * jedno; obojí je špatně. Průkaz proto zůstává na tomhle kusu železa.
 *
 * ⭐ Chování po obnově ze zálohy je tím pádem „nemám průkaz" ⇒ žebříček
 * (`dalsiKrokDveri`) pošle člověka na ruční kód. To je zamýšlené, ne mezera.
 */
export function nativeUlozisteKlicu(): UlozisteKlicu {
  return {
    precti: (klic) => SecureStore.getItemAsync(klic),
    zapis: (klic, hodnota) =>
      SecureStore.setItemAsync(klic, hodnota, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    smaz: (klic) => SecureStore.deleteItemAsync(klic),
  };
}

/**
 * P-256 pár a ECDSA podpis pro průkaz zařízení.
 *
 * ⛔ `dsaEncoding: 'ieee-p1363'` NENÍ kosmetika. Výchozí kódování ECDSA podpisu
 * je DER, které má PROMĚNNOU délku (70–72 B). Rámec čeká přesně `SIG_BYTES`
 * (64 B, r||s) a `encodeFrameDevice` délku kontroluje, takže DER by se ani
 * neodeslal — ale bez téhle věty by to vypadalo jako vada rámce, ne jako vada
 * kódování podpisu. Ověřovatel (`ecdsaP256Verify`) čte tytéž syrové r||s.
 *
 * ⛔ VEŘEJNÝ KLÍČ VYVÁŽÍME JAKO `raw-public`/`uncompressed` — to je přesně
 * SEC1 `0x04||X||Y`, tvar, který čeká `verify.ts` (`PUBKEY_BYTES = 65`).
 * Skládat ho z JWK po částech by znamenalo dopisovat vlastní base64url a
 * doplňování na 32 B; tvar by se rozešel tiše a projevil se až jako `bad-sig`.
 * Délku i tak MĚŘÍ `zkontrolujVerejnyKlic` — tenhle adaptér není testovaný
 * jestem (linkuje C++), takže kontrola musí být na straně, která testovaná je.
 */
export function nativeKryptoZarizeni(): KryptoZarizeni {
  return {
    novyPar: () => {
      const { publicKey, privateKey } = qc.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const raw = publicKey.export({ format: 'raw-public', type: 'uncompressed' }) as unknown as Uint8Array;
      return {
        privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as unknown as string,
        publicKeyHex: RNBuffer.from(raw).toString('hex'),
      };
    },
    podepis: (privateKeyPem, zprava) =>
      new Uint8Array(
        qc
          .createSign('SHA256')
          .update(RNBuffer.from(zprava))
          .sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' }),
      ),
  };
}

/**
 * Zavedení a zrušení průkazu zařízení — úkony ČLOVĚKA, ne automatiky.
 *
 * ⛔ `zaved` (tedy `povereniZarizeni`) SMÍ VOLAT JEN OBSLUHA VÝSLOVNÉHO
 * STISKU. Automatická cesta má vlastní, čtecí sestavení (`nativeObsluhaDveri`),
 * které pověření nezakládá — a brána v `obsluhaDveri.test.ts` hlídá, že se ty
 * dvě cesty nespletou.
 *
 * ⭐ ZAVEDENÍ NIC NEPOVOLUJE. Vyrobí pár a ukáže otisk; dokud správce ten otisk
 * neschválí, je zařízení pro vrátného `unknown-kid` — tedy přesně tak němé jako
 * předtím. Proto se smí nabídnout i po zaťukání, o kterém nevíme, jestli
 * prošlo: „odesláno" není „otevřeno" a zavedení na tom nic nemění.
 */
export interface ZarizeniUkony {
  nacti: () => Promise<PovereniZarizeni | null>;
  /** `scope` je povinný a ULOŽÍ SE — viz `PovereniZarizeni.scope`. */
  zaved: (scope: string) => Promise<PovereniZarizeni>;
  zapomen: () => Promise<void>;
}

export function nativeZarizeni(): ZarizeniUkony {
  const uloziste = nativeUlozisteKlicu();
  return {
    nacti: () => nactiPovereni(uloziste),
    zaved: (scope) => povereniZarizeni(uloziste, nativeKryptoZarizeni(), scope),
    zapomen: () => zapomenZarizeni(uloziste),
  };
}

let zdrojRelace: ZdrojRelace | null = null;

/**
 * Relace tabletu (F2) — JEDNA na proces: mezipaměť tokenu i „jeden požadavek naráz“
 * mají smysl jen tehdy, když se všichni ptají téhož zdroje.
 */
export function nativeZdrojRelace(): ZdrojRelace {
  zdrojRelace ??= vytvorZdrojRelace({ ...nativeTabletDeps(), nactiPovereni: () => nativeZarizeni().nacti() });
  return zdrojRelace;
}

/** Síť, podpis a čas pro ohlášení tabletu bráně (`ohlaseniTabletu.ts`). */
export function nativeTabletDeps(): TabletDeps {
  return {
    crypto: { randomBytes: (n: number): Uint8Array => new Uint8Array(qc.randomBytes(n)) },
    fetch: (vstup, init) => fetch(vstup, init),
    nowSec: () => Math.floor(Date.now() / 1000),
    podepis: nativeKryptoZarizeni().podepis,
    zakladUrl: getBackendUrl,
  };
}
