/**
 * Otisk ODVOZENÝCH klíčů v SoT — aby šlo poznat, že se svět pod nasazením hnul.
 *
 * ⛔ NAMĚŘENO 2026-09-03 V PROVOZU. Nasazení skončilo `exit=0` a hlásilo
 * „5 spuštěno, 5 zdravých, 0 selhání" — a přitom `<fork>-core` odjel se seznamem
 * důvěry BEZ JEDINÉ adresy mesh peera, kdežto `<fork>-edge` jich měl 23.
 *
 * Průběh: ve vlně 6 mesh discovery DVAKRÁT selhalo (přerušený dotaz na token
 * Keycloaku), takže `MESH_PEER_IPS` bylo pořád prázdné a `core` se
 * synchronizoval s prázdnou derivací. Ve vlně 7 discovery uspělo a zapsalo
 * 23 peerů; `edge` je ve vlně 10 dostal, `core` už ne — ten byl hotový.
 *
 * ⭐ TŘÍDA VADY: SoT se během běhu ZMĚNÍ a appky nasazené PŘED tou změnou nesou
 * starou hodnotu. Souhrn o tom neví, protože měří „doběhlo a je zdravé", ne
 * „nese to, co má". Zelená není totéž co splněný záměr.
 *
 * ⭐ UNIVERZUM SE ČTE Z KONTRAKTU, NEPÍŠE RUKOU. Klíče vydá env-doktor
 * (`--print-contract-keys`), takže nový odvozený klíč je pokrytý dnem svého
 * vzniku. Ručně psaný seznam by zdědil díry svého autora — a byly by v něm jen
 * ty dva klíče, které zrovna dnes bolely.
 *
 * ⛔ PATIČKA SE VYMÁHÁ. Useknutý výstup (roura, plánovač) by vypadal jako kratší
 * kontrakt a otisk by se počítal jen z části — tedy měřidlo, které mlčky mine
 * část světa. Bez patičky se proto NEVYDÁ závěr, ale chyba.
 */
import { createHash } from "node:crypto";

const PATICKA = "__CONTRACT_END__";

/**
 * @param {string} vystupKontraktu stdout z `aisha-env-doctor.mjs --print-contract-keys`
 * @returns {string[]} jména klíčů druhu `derived`, seřazená
 */
export function odvozeneKlice(vystupKontraktu) {
  const klice = [];
  let patickaDorazila = false;
  for (const radek of String(vystupKontraktu ?? "").split("\n")) {
    const [klic, druh] = radek.split("\t");
    if (klic === PATICKA) { patickaDorazila = true; break; }
    if (druh === "derived" && klic) klice.push(klic);
  }
  if (!patickaDorazila) {
    throw new Error(
      "kontrakt env-doktora dorazil USEKNUTY (chybi " + PATICKA + ") — " +
        "z casti kontraktu se otisk nepocita, byl by to zaver z neuplneho mereni",
    );
  }
  return klice.sort();
}

/**
 * @param {string} sot obsah `.env.coolify`
 * @param {string[]} klice jména odvozených klíčů
 * @returns {{otisk: string, pocet: number, chybejici: string[]}}
 */
export function otiskOdvozenych(sot, klice) {
  const h = createHash("sha256");
  const chybejici = [];
  for (const k of klice) {
    const m = String(sot ?? "").match(new RegExp(`^${k}=(.*)$`, "m"));
    if (!m) chybejici.push(k);
    // Chybějící klíč se do otisku promítne VÝSLOVNĚ — jinak by „klíč zmizel"
    // a „klíč má prázdnou hodnotu" daly týž otisk, tedy dva různé stavy
    // k nerozeznání.
    h.update(`${k}=${m ? m[1] : " CHYBI"}\n`);
  }
  return { otisk: h.digest("hex").slice(0, 16), pocet: klice.length, chybejici };
}
