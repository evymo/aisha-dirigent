#!/usr/bin/env node
/**
 * knock-roster.mjs — vyrobit roster operátorů pro `SPA_OPERATORS_B64`.
 *
 * Roster je mapa `kid → pověření`, kterou `svc-knock` čte z prostředí. Bez něj
 * služba vědomě NENASTARTUJE (`configDefects`): chybějící tajemství není
 * „volnější nastavení", je to chybějící vstup.
 *
 * ⭐ TÝŽ VÝPOČET JAKO TELEFON. Materiál se odvozuje `deriveFromPassword()` ze
 * sdíleného balíčku — toho, který v mobilu volá `knockWithCode`. Kdyby si roster
 * odvozoval po svém, server by čekal jiné klíče, než jaké telefon vyrobí, a
 * zaťukání by padalo na `bad-hmac` bez zjevné příčiny.
 *
 * ⛔ HESLO SE NEBERE Z ARGUMENTŮ. Argumenty vidí `ps` každý uživatel stroje a
 * zůstávají v historii shellu. Čte se z terminálu bez opisu, a dvakrát:
 * překlep v break-glass hesle se pozná až ve chvíli, kdy se jím někdo pokouší
 * dostat dovnitř — tedy přesně tehdy, kdy na opravu není čas.
 *
 * ⛔ NIC SE NEUKLÁDÁ. Skript píše roster na stdout a nic nezapisuje na disk;
 * odvozené klíče se nikdy netisknou jednotlivě. Kam se výsledek uloží, je
 * rozhodnutí člověka (Coolify → proměnná prostředí), ne skriptu.
 *
 * Použití:
 *   node scripts/knock-roster.mjs --kid ops-zdenek --scope ops
 *   node scripts/knock-roster.mjs --kid telefon-1 --scope drive --device
 *   node scripts/knock-roster.mjs --kid a --scope ops --merge "$SPA_OPERATORS_B64"
 *
 *   node scripts/knock-roster.mjs --pubkey 04ab… --owned-by zdenek --scope drive
 *
 *   --device  pověření ZAŘÍZENÍ VER 1: náhodné klíče místo hesla (telefon si je
 *             uloží do secure-store). Vypíše je jednou — podruhé už je nikdo
 *             nezjistí. Server ta tajemství ZNÁ, takže může ťukat za zařízení.
 *   --pubkey  průkaz ZAŘÍZENÍ VER 2: telefon si vyrobil pár sám a ukazuje
 *             veřejnou půlku (klepátko → „Toto zařízení" → otisk). Sem se
 *             opíše jen ta veřejná hodnota; server žádné tajemství nedostane
 *             a ťukat za zařízení NEMŮŽE. To je celý smysl VER 2.
 *   --owned-by  KOMU zařízení patří. Povinné u `--pubkey`: schvaluje se
 *             u uživatele, takže průkaz bez majitele nemá kde viset.
 *   --merge   přidá kid do existujícího rosteru místo výroby nového
 *
 * ⛔ PROČ `--pubkey` PŘIBYLO (2026-09-09). VER 2 ověřování bylo hotové
 * (`verify.ts`, `encodeFrameDevice`) a telefon si pár uměl vyrobit — ale
 * neexistoval podporovaný způsob, jak takové zařízení do rosteru DOSTAT.
 * `--device` vyrábí VER 1 se sdíleným tajemstvím, které `operatorDefects`
 * u VER 2 výslovně zakazuje. Schopnost tedy měla obě strany a žádnou cestu
 * mezi nimi — táž třída jako žebříček ke dveřím bez volajícího.
 */
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { kidZKlice, operatorDefects, PUBKEY_BYTES } from '../packages/knock-protocol/dist/index.js';
import { deriveFromPassword, freshDeviceSecrets } from '../packages/knock-protocol/dist/node.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

const scope = flag('--scope');
const merge = flag('--merge');
const pubkey = flag('--pubkey');
const ownedBy = flag('--owned-by');

/*
  ⛔ U `--pubkey` SE `kid` NEZADÁVÁ, ODVOZUJE SE Z KLÍČE — týmž výpočtem, jaký
  použil telefon (`kidZKlice` ze sdíleného balíčku). Kdyby si ho člověk zadal
  ručně a přepsal se, roster by pod tím jménem klíč nenašel a zaťukání by padalo
  na `unknown-kid`, tedy MLČENÍM k nerozeznání od zavřených dveří. Nesouhlasné
  `--kid` je proto CHYBA, ne přání.
*/
let kid = flag('--kid');
if (pubkey) {
  const odvozene = kidZKlice(pubkey);
  if (kid && kid !== odvozene) {
    console.error(
      `knock-roster: --kid „${kid}“ neodpovídá klíči — z něj vychází „${odvozene}“.\n` +
        '  Otisk se odvozuje z klíče, nevymýšlí se: schvaluje se KLÍČ, ne jméno.',
    );
    process.exit(2);
  }
  kid = odvozene;
}

if (!kid || !scope) {
  console.error(
    'knock-roster: --kid a --scope jsou povinné (u --pubkey se kid odvodí z klíče)\n' +
      '  scope se NEODVOZUJE: prázdný seznam by u ověření znamenal „jakýkoli scope“.\n' +
      '  příklad: node scripts/knock-roster.mjs --kid ops-zdenek --scope ops',
  );
  process.exit(2);
}

if (pubkey && !ownedBy) {
  console.error(
    'knock-roster: --owned-by je u --pubkey povinné\n' +
      '  Zařízení se schvaluje U UŽIVATELE. Průkaz bez majitele nemá v administraci\n' +
      '  kde viset a při odvolání účtu by zůstal viset sám.',
  );
  process.exit(2);
}

/** Přečte řádek z terminálu BEZ OPISU. */
function tajneZadani(vyzva) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('heslo se čte jen z terminálu — roura by ho nechala v historii nebo v souboru'));
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Potlačení opisu: writeToOutput dostane každý znak, my vypíšeme jen výzvu.
    let vypsanaVyzva = false;
    rl._writeToOutput = (s) => {
      if (!vypsanaVyzva) {
        process.stdout.write(vyzva);
        vypsanaVyzva = true;
      } else if (s.includes('\n')) {
        // Enter se propíše jako odřádkování — jinak by další výzva začala na
        // témž řádku a vypadalo by to, že se skript zasekl.
        process.stdout.write('\n');
      }
    };
    rl.question(vyzva, (odpoved) => {
      rl.close();
      resolve(odpoved);
    });
  });
}

/**
 * Vygeneruje kód, který si člověk přepíše do telefonu.
 *
 * ⭐ PROČ TO SMÍ VZNIKNOUT STROJOVĚ (dořešeno 2026-08-19 s majitelem)
 * Zakázaný je TICHÝ default — hodnota, kterou nikdo nezvolil a nikdo se o ní
 * nedozví. Vygenerovaný a NAHLAS OZNÁMENÝ kód tichý default není; je to totéž
 * provisioning, jaký cold-start dělá u `PLATFORM_ADMIN_PASSWORD`. Bez něj
 * zůstane `svc-knock` (fail-closed) trvale dole a stáhne s sebou celý edge —
 * naměřeno 2026-08-19, pět kontejnerů. Nemít kód je horší než mít vygenerovaný.
 *
 * ⛔ ABECEDA BEZ ZÁMĚN. Kód se přepisuje z obrazovky do telefonu, takže z ní
 * vypadává `0/O`, `1/l/I` a `5/S`: překlep by se projevil jako `bad-hmac`,
 * tedy MLČENÍM k nerozeznání od zavřených dveří. Skupiny po čtyřech se čtou
 * po telefonu líp než souvislý řetězec.
 * Entropie: 4 skupiny × 4 znaky z 29znakové abecedy ≈ 78 bitů — na sdílené
 * tajemství, které chrání jen „smím se pokusit o autorizaci", s rezervou dost.
 */
function vygenerujKod() {
  const abeceda = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
  const bajty = randomBytes(16);
  const znaky = [...bajty].map((b) => abeceda[b % abeceda.length]);
  return [0, 4, 8, 12].map((i) => znaky.slice(i, i + 4).join('')).join('-');
}

let material;
let vygenerovanyKod = null;
if (pubkey) {
  // VER 2: nic se neodvozuje ani negeneruje. Tajemství tu žádné nevzniká —
  // soukromá půlka zůstala v telefonu a tenhle skript ji nikdy neuvidí.
  material = null;
} else if (has('--generate')) {
  // Neinteraktivní cesta pro cold-start / warmup: kód vznikne tady, odvození
  // klíčů je TOTOŽNÉ jako u zadaného hesla (jeden výpočet, jedno místo).
  vygenerovanyKod = vygenerujKod();
  material = deriveFromPassword(vygenerovanyKod, kid);
} else if (has('--device')) {
  // Zařízení nepoužívá lidské heslo: má náhodné klíče, které si uloží do
  // secure-store. Heslo je cesta break-glass, ne trvalé pověření.
  material = freshDeviceSecrets();
} else {
  const heslo = await tajneZadani(`heslo pro kid „${kid}“: `);
  if (!heslo) {
    console.error('knock-roster: prázdné heslo — HMAC prázdným klíčem je pořád platný HMAC, takže by to nic nerozbilo a nic nezakřičelo');
    process.exit(2);
  }
  const znovu = await tajneZadani('ještě jednou pro kontrolu: ');
  if (heslo !== znovu) {
    console.error('knock-roster: hesla se neshodují — nic se nevyrobilo');
    process.exit(2);
  }
  material = deriveFromPassword(heslo, kid);
}

/*
  ⛔ VER 2 ZÁZNAM NESMÍ NÉST `hmacKeyHex` ANI `otpSeedHex` — ani prázdné.
  `operatorDefects` to odmítne a má pravdu: kdyby je server měl, DRŽEL by
  tajemství, kterým se dá za to zařízení zaťukat, a věta „klíč neopustil telefon"
  by byla tvrzení, které data popírají.
*/
const operator = pubkey
  ? { publicKeyHex: pubkey, scopes: [scope], kind: 'device', ownedBy }
  : {
      hmacKeyHex: material.hmacKeyHex,
      otpSeedHex: material.otpSeedHex,
      scopes: [scope],
      kind: has('--device') ? 'device' : 'person',
    };

// Ověřit TÝMŽ predikátem, jakým se řídí start služby. Jinak by roster mohl projít
// tudy a shodit `svc-knock` až při nasazení — daleko od místa, kde vznikl.
const vady = operatorDefects(kid, operator);
if (vady.length) {
  console.error(`knock-roster: vyrobené pověření by službu neprošlo:\n  ${vady.join('\n  ')}\n`);
  process.exit(1);
}

let roster = {};
if (merge) {
  try {
    roster = JSON.parse(Buffer.from(merge, 'base64').toString('utf8'));
  } catch {
    console.error('knock-roster: --merge není platný base64 JSON');
    process.exit(2);
  }
  if (roster[kid]) {
    // Přepis by tiše odřízl zařízení, které pod tím kid právě chodí dovnitř.
    console.error(`knock-roster: kid „${kid}“ už v rosteru je — zvol jiný, nebo ho napřed odeber\n`);
    process.exit(2);
  }
}
roster[kid] = operator;

// Na stdout JEN výsledek, ať se dá přesměrovat; poznámky na stderr.
console.error(
  `\nkid: ${kid} · scope: ${scope} · druh: ${operator.kind} · celkem v rosteru: ${Object.keys(roster).length}\n` +
    (pubkey
      ? `průkaz ZAŘÍZENÍ (VER 2) · majitel: ${ownedBy} · veřejný klíč ${PUBKEY_BYTES} B\n` +
        'Žádné tajemství tu nevzniklo — soukromá půlka zůstala v telefonu.\n'
      : has('--device')
      ? 'pověření zařízení se vypisuje JEDNOU — telefon si je uloží do secure-store:\n' +
        `  hmacKeyHex: ${material.hmacKeyHex}\n  otpSeedHex: ${material.otpSeedHex}\n`
        : vygenerovanyKod
        ? // Kód se NIKAM neukládá — z rosteru ho zpět nespočítáš (je to jednosměrné
          // odvození). Tenhle výpis je jediná příležitost, kdy ho člověk uvidí;
          // kdyby chyběl, vzniklo by tajemství, které nikdo nezná = tichý default.
          `\n  ╭────────────────────────────────────────────╮\n` +
          `  │  KÓD KE DVEŘÍM — zadáš ho v mobilní appce  │\n` +
          `  │                                            │\n` +
          `  │            ${vygenerovanyKod}            │\n` +
          `  │                                            │\n` +
          `  ╰────────────────────────────────────────────╯\n` +
          '  Zobrazí se JEDNOU: z rosteru ho zpětně spočítat nelze.\n' +
          '  Vlastní kód místo vygenerovaného: spusť bez --generate.\n'
        : 'heslo se nikam neuložilo; klíče se z něj odvodí pokaždé znovu\n') +
    '\nvlož jako SPA_OPERATORS_B64 (dveře zapíná JEN deklarace instance — edge_profiles: ["knock"], ne ruční COMPOSE_PROFILES):\n',
);
process.stdout.write(Buffer.from(JSON.stringify(roster), 'utf8').toString('base64') + '\n');
