/**
 * VAPID pár (Web Push, RFC 8292) — výroba a POSUDEK uloženého stavu.
 *
 * Jeden domov pro pravidlo, které dřív žilo jen v `generate-secrets.mjs`:
 * čte ho generátor (cold-start) i env-doktor. Doktor měl do 2026-09-23 u obou
 * klíčů druh `secret`, tedy NÁHODU — 65 bajtů, které nejsou bodem křivky, a
 * soukromý klíč, ke kterému nepatří. Prohlížeč se k odběru takovým klíčem
 * nepřihlásí vůbec a svc-push při startu web push vypne (`web push VYPNUT`).
 *
 * ⭐ PÁR NEJSOU DVĚ TAJEMSTVÍ. Je to jedno tajemství (skalár d) a jeho funkce
 * (veřejný = d·G). Z toho plyne celá tabulka v `posudVapidPar`:
 *   - chybí veřejný → ODVODÍ se; žádná rotace, odběry přežijí;
 *   - chybí soukromý → obnovit NEJDE; nový pár = rotace, a to je rozhodnutí.
 *
 * Tvar podle RFC 8292: veřejný = nekomprimovaný bod 0x04||X||Y (65 B),
 * soukromý = skalár d (32 B), oba base64url. Naměřeno na Node 22: `setPrivateKey`
 * sám pustí i 31 bajtů a `convertKey` i komprimovaný bod (33 B) — délky a
 * prefix se proto hlídají zvlášť, knihovna je za nás neuhlídá.
 */
import crypto from "node:crypto";

const KRIVKA = "prime256v1";
const DELKA_VEREJNEHO = 65;
const DELKA_SOUKROMEHO = 32;

/** Nový pár. JWK, protože `spki`/`pkcs8` nesou ASN.1 obal, který Web Push nebere. */
export function vyrobVapidPar() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: KRIVKA });
  const j = privateKey.export({ format: "jwk" });
  const bod = Buffer.concat([Buffer.from([0x04]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]);
  return { verejny: bod.toString("base64url"), soukromy: j.d };
}

/** Veřejný klíč ze soukromého; `null`, když soukromý není platný skalár P-256. */
export function verejnyZeSoukromeho(soukromy) {
  const d = Buffer.from(soukromy, "base64url");
  if (d.length !== DELKA_SOUKROMEHO) return null;
  try {
    const ecdh = crypto.createECDH(KRIVKA);
    ecdh.setPrivateKey(d); // odmítne 0 a skalár ≥ n
    return ecdh.getPublicKey(null, "uncompressed").toString("base64url");
  } catch {
    return null;
  }
}

/** Nese hodnota tvar, kterým se prohlížeč smí přihlásit k odběru? */
export function jeVerejnyVapid(verejny) {
  const b = Buffer.from(verejny, "base64url");
  if (b.length !== DELKA_VEREJNEHO || b[0] !== 0x04) return false;
  try {
    crypto.ECDH.convertKey(b, KRIVKA, undefined, undefined, "uncompressed"); // bod na křivce?
    return true;
  } catch {
    return false;
  }
}

/**
 * Posudek uloženého stavu. Vrací, CO udělat — nic nezapisuje.
 *
 * akce:
 *   "ponechat"          — úplný platný pár
 *   "vyrobit"           — nic tu není; nový pár
 *   "doplnit-verejny"   — soukromý platí, veřejný chybí → odvozený
 *   "nahradit-verejny"  — soukromý platí, veřejný NENÍ bod ve tvaru RFC 8292.
 *                         Pod takovým klíčem nemohl vzniknout žádný odběr
 *                         (prohlížeč ho odmítne), takže přepsáním nic nezanikne.
 *                         Přesně tenhle stav vyráběl doktor druhem `secret`.
 *   "stop"              — neopravitelné bez člověka; `duvod` říká proč a co dál
 *
 * @param {{ verejny?: string, soukromy?: string }} ulozeno  prázdný řetězec = chybí
 * @returns {{ akce: string, duvod: string, verejny?: string, soukromy?: string }}
 */
export function posudVapidPar({ verejny = "", soukromy = "" }) {
  if (!verejny && !soukromy) {
    return { akce: "vyrobit", duvod: "pár chybí celý", ...vyrobVapidPar() };
  }
  if (!soukromy) {
    return {
      akce: "stop",
      duvod:
        "veřejný klíč je, soukromý CHYBÍ — z veřejného ho získat nejde. Buď obnov soukromý ze zálohy " +
        "(.backup/, .env-prod-backup), nebo smaž i veřejný a spusť znovu (= vědomá ROTACE: odběry " +
        "pod starým klíčem zaniknou a prohlížeče se přihlásí znovu).",
    };
  }
  const odvozeny = verejnyZeSoukromeho(soukromy);
  if (!odvozeny) {
    return {
      akce: "stop",
      duvod:
        "soukromý klíč NENÍ platný skalár P-256 (čekám 32 bajtů base64url, 0 < d < n). Obnov ho ze " +
        "zálohy, nebo smaž oba klíče a spusť znovu (= vědomá rotace).",
    };
  }
  if (!verejny) {
    return { akce: "doplnit-verejny", duvod: "veřejný odvozen ze soukromého (bez rotace)", verejny: odvozeny, soukromy };
  }
  if (verejny === odvozeny) return { akce: "ponechat", duvod: "úplný platný pár", verejny, soukromy };
  if (!jeVerejnyVapid(verejny)) {
    return {
      akce: "nahradit-verejny",
      duvod: "uložený veřejný není bod křivky ve tvaru RFC 8292 — nikdo se jím nemohl přihlásit; odvozen ze soukromého",
      verejny: odvozeny,
      soukromy,
    };
  }
  return {
    akce: "stop",
    duvod:
      "oba klíče jsou platné, ale NEPATŘÍ K SOBĚ — nevím, který je ten pravý (prohlížeče odebírají " +
      "uloženým veřejným, svc-push podepisuje uloženým soukromým). Najdi ve zálohách původní pár, " +
      "nebo smaž oba a spusť znovu (= vědomá rotace).",
  };
}
