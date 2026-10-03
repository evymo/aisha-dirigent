import type { ExpoConfig, ConfigContext } from 'expo/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract base URL from Sentry DSN.
 * DSN format: https://KEY@host/PROJECT_ID → https://host
 */
const extractSentryUrlFromDsn = (dsn: string | undefined): string | undefined => {
  if (!dsn) return undefined;
  try {
    const match = dsn.match(/https?:\/\/[^@]+@([^/]+)/);
    if (match?.[1]) {
      return `https://${match[1]}`;
    }
  } catch {
    // fallback
  }
  return undefined;
};

// ============================================================================
// Version Configuration — Read from version.json (source of truth)
// ============================================================================
interface VersionConfig {
  version: string;
  build: number;
  app: {
    displayName: string;
    bundleId: string;
    category: string;
  };
  brand: {
    slug: string;
    scheme: string;
    xcodeName: string;
    shortName: string;
    assistantName: string;
    backgroundColor: string;
    gatewayPinned: boolean;
    /**
     * Kam přihlášený NE-admin přistane: 'tabs' (členská domovská), nebo SLUG
     * EXTRANETOVÉ SEKCE ('porada', 'vyvoz', 'meridla', …).
     *
     * ⛔ Býval to uzavřený výčet dvou hodnot a tím se sem nedostala žádná další
     * sekce bez změny kódu platformy — přestože sekce je otevřený text v DB
     * (`surface_layouts.surface`). Rezervované je jediné slovo: 'tabs'.
     */
    defaultSurface?: string;
    /**
     * Orientace obrazovky: 'portrait' | 'landscape' | 'default' (řídí se zařízením
     * a jeho nastavením automatického otáčení). Chybí = 'portrait' (dosavadní chování
     * všech appek), takže ostatní builda se nemění.
     *
     * ⭐ Majitel 2026-09-30 (Řidič na tabletu v kabině): appka se neotáčela podle
     * nastavení displeje. Zámek na výšku byl v kódu pro všechny; na Androidu 16 ho
     * systém na velkém displeji ignoruje, na Androidu 15 ne — tablety se tak chovaly
     * každý jinak a dvousloupec (master–detail, jen na šířku) byl na A15 nedosažitelný.
     */
    orientation?: 'portrait' | 'landscape' | 'default';
    /**
     * Kterou ČÁST appky tenhle build vydává. Chybí = deštníkový build (vše).
     *
     * Tohle je celý mechanismus „exkluzivní appka pro jeden účel": appka řidiče
     * = `{ sections: ['vyvoz'] }`, miniappka na odečty = `{ sections:
     * ['meridla'] }`. Týž kód, jiná data — žádný fork, žádná druhá větev.
     *
     * ⚠️ Zúžení, nikdy rozšíření: nárok rozhoduje server. Že jsou jmenované
     * sekce a taby SKUTEČNÉ, měří brána při buildu (univerzum se odvozuje).
     */
    appSlice?: {
      sections?: string[];
      tabs?: string[];
    };
    /**
     * Čím se v TÉHLE appce věci jmenují: `{ cs: { "workflow.steps.title":
     * "Moje dodávky" }, en: { … } }`.
     *
     * Platforma mluví o „krocích procesu", protože obsluhuje libovolný proces;
     * řidič má DODÁVKY, odečtář ODEČTY. Totéž tvrzení, jiné slovo — a to slovo
     * je vlastnost instance, ne platformy, takže by v `cs.json` být nemělo.
     *
     * ⛔ PŘEPISUJE, NEZAVÁDÍ: klíč, který v katalogu není, je překlep a build
     * ZASTAVÍ (viz `overSlovnik` níž). Za běhu se to říct nedá — obrazovka se
     * prostě nezeptá a chybný klíč by mlčel až do reklamace z terénu.
     */
    slovnik?: Record<string, Record<string, string>>;
    /**
     * Brand a téma jazyka ESDK (`@aisha/extranet-sdk-native`). Chybí = brand podle
     * `slug`, téma `noc`: appka je jen tmavá (StatusBar light, pozadí z brand tokenů),
     * takže světlé `den` by na ní kreslilo tmavý text na tmavé (naměřeno 2026-09-29:
     * EsdkProvider nikdo nezapojil a Es.* běžely ve výchozím `den`).
     */
    esdk?: { brand?: string; theme?: 'den' | 'noc' };
    sentry: {
      project: string;
      organization: string;
      url: string;
    };
  };
  ios: {
    marketingVersion: string;
    buildNumber: number;
    deploymentTarget: string;
  };
  android: {
    versionCode: number;
    versionName: string;
    minSdkVersion: number;
    targetSdkVersion: number;
  };
}

/**
 * Identita aplikace. Instance ji přebíjí přes `AISHA_APP_VERSION_FILE`, aby si
 * nemusela sahat na soubor platformy — každá instance má vlastní bundle
 * (platforma svůj, každá instance vlastní bundle id) a vlastní Firebase projekt.
 *
 * ŽÁDNÝ FALLBACK. Dřív tu byla natvrdo dosazená identita platformy pro případ,
 * že se soubor nepodaří přečíst — jenže to je ta nejhorší možná tichá domněnka:
 * build projde, vyrobí appku s CIZÍM bundle ID a jménem, a pozná se to až ve
 * storu. Nepřečtený soubor tedy build zastaví.
 */
/** Kde leží profil appky (version.json) — a vedle něj slovník instance (i18n.json). */
const VERSION_PATH = process.env.AISHA_APP_VERSION_FILE
  ? path.resolve(process.env.AISHA_APP_VERSION_FILE)
  : path.join(__dirname, 'version.json');

const loadVersionConfig = (): VersionConfig => {
  const versionPath = VERSION_PATH;
  let content: string;
  try {
    content = fs.readFileSync(versionPath, 'utf8');
  } catch (err) {
    throw new Error(
      `app.config: nelze přečíst identitu aplikace z ${versionPath} (${(err as Error).message}).\n` +
        'Build se zastavuje záměrně — dosazená výchozí identita by vyrobila aplikaci ' +
        's cizím bundle ID a jménem a poznalo by se to až ve storu.\n' +
        'Pro instanční build nastav AISHA_APP_VERSION_FILE na profil té instance.',
    );
  }
  let parsed: VersionConfig;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`app.config: ${versionPath} není platný JSON (${(err as Error).message}).`);
  }
  // Chybějící bundleId je táž vada jako chybějící soubor — jen se hůř hledá.
  if (!parsed?.app?.bundleId || !parsed?.brand?.slug) {
    throw new Error(`app.config: ${versionPath} neuvádí app.bundleId nebo brand.slug.`);
  }
  return parsed;
};

/**
 * ⛔ SLOVNÍK INSTANCE NESMÍ JMENOVAT KLÍČ, KTERÝ NEEXISTUJE.
 *
 * Překlep v `brand.slovnik` je za běhu NEVIDITELNÝ: `t()` sáhne po klíči, který
 * instance přepsala jinak, nenajde přepis a vrátí platný původní text. Appka
 * vypadá zdravě a slovník prostě neplatí — pozná se to až reklamací z terénu
 * („pořád tam je Moje kroky"), tedy nejdřív za týdny.
 *
 * ⭐ MĚŘÍ SE PŘEBYTEK, UNIVERZUM SE HLEDÁ. Nedostatek (klíč, který instance
 * nepřepsala) vada NENÍ — slovník je částečný ze své podstaty. Vada je klíč
 * navíc, protože ten nemůže nic udělat. Katalog se proto čte ZE SOUBORU,
 * ne z ručně vedeného seznamu, který by zetlel.
 *
 * ⚠️ Kontroluje se proti ČESKÉMU katalogu bez ohledu na jazyk přepisu: oba
 * katalogy drží tutéž množinu klíčů (hlídá `check-i18n-parity`), takže jeden
 * stačí — a druhý zdroj téhož tvrzení by se s ním jen mohl rozejít.
 */
const overSlovnik = (v: VersionConfig): void => {
  const slovnik = v.brand.slovnik;
  if (!slovnik) return;

  const katalog: unknown = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'src/i18n/cs.json'), 'utf8'),
  );
  const existuje = (klic: string): boolean => {
    let uzel: unknown = katalog;
    for (const cast of klic.split('.')) {
      if (!uzel || typeof uzel !== 'object') return false;
      uzel = (uzel as Record<string, unknown>)[cast];
    }
    return typeof uzel === 'string';
  };

  const navic: string[] = [];
  for (const [jazyk, mapa] of Object.entries(slovnik)) {
    for (const klic of Object.keys(mapa ?? {})) {
      if (!existuje(klic)) navic.push(`${jazyk}: ${klic}`);
    }
  }
  if (navic.length > 0) {
    throw new Error(
      'app.config: brand.slovnik jmenuje klíče, které v katalogu neexistují:\n' +
        navic.map((k) => `  · ${k}`).join('\n') +
        '\nJe to překlep: za běhu by mlčel a appka by dál ukazovala původní text.\n' +
        'Klíče se berou ze src/i18n/cs.json — slovník PŘEPISUJE, nezavádí nové.',
    );
  }
};

const VERSION = loadVersionConfig();

/**
 * Orientace z profilu appky. Neznámá hodnota ZASTAVÍ build — za běhu by se to
 * poznalo až jako „appka se neotáčí“ na konkrétním tabletu.
 */
function orientaceObrazovky(v: unknown): 'portrait' | 'landscape' | 'default' {
  if (v === undefined) return 'portrait';
  if (v === 'portrait' || v === 'landscape' || v === 'default') return v;
  throw new Error(`version.json brand.orientation: „${String(v)}“ — povoleno portrait | landscape | default`);
}
overSlovnik(VERSION);

/**
 * SLOVNÍK INSTANCE (`i18n.json` vedle `version.json`) — klíče, které platforma NEZNÁ.
 *
 * ⛔ NAMĚŘENO 2026-09-29: řidičská páska kreslila surové klíče („block.vyvoz.handover“,
 * „app.wf.field.where“) a nadpis „vyvoz“. Ty klíče instance MÁ — v `surfaces/<povrch>/
 * i18n.json` — jenže build appky ten soubor nikdy nečetl (četl ho jen web). Bloky
 * a sekce jsou data instance, takže jejich názvy do `cs.json` platformy nepatří.
 *
 * ⭐ DOPLŇUJE, NEPŘEPISUJE: klíč z katalogu platformy vyhrává (přejmenování je věc
 * `brand.slovnik`), slovník instance jen zaplní, co platforma nezná. Bere se jen to,
 * co appka umí zobrazit (cs, en). Chybí-li soubor, není co doplnit — deštníkový
 * build instanci nemá.
 */
const JAZYKY_APPKY = ['cs', 'en'] as const;
const loadInstanceI18n = (): Record<string, Record<string, string>> => {
  const cesta = path.join(path.dirname(VERSION_PATH), 'i18n.json');
  if (!fs.existsSync(cesta)) return {};
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(cesta, 'utf8'));
  } catch (err) {
    throw new Error(`app.config: ${cesta} není platný JSON (${(err as Error).message}).`);
  }
  const out: Record<string, Record<string, string>> = {};
  for (const jazyk of JAZYKY_APPKY) {
    const mapa = data[jazyk];
    if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) continue;
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapa as Record<string, unknown>)) {
      if (!k.startsWith('_') && typeof v === 'string' && v.trim() !== '') p[k] = v;
    }
    out[jazyk] = p;
  }
  return out;
};
const INSTANCE_I18N = loadInstanceI18n();

/**
 * PÍSMA JAZYKA RDL (Archivo · Inter · IBM Plex Mono), přibalená nativně.
 *
 * ⛔ Appka nenačítala žádné písmo, takže ESDK (fonts.display/sans/mono) i motivy makety
 * řidiče padaly na systémové. Kit písma schválně nedodává (README: „přibal je“).
 * ⭐ Android dostane RODINU s řezy (XML font family), takže `fontFamily: 'Archivo'`
 * + `fontWeight: '800'` + `fontStyle: 'italic'` vybere správný řez — bez toho Android
 * váhy vlastního písma nesyntetizuje. iOS řez vybírá sám podle rodiny a váhy.
 * Licence všech tří: SIL OFL 1.1 (LICENSE_FONT v balíčcích).
 */
type RezPisma = { vaha: number; soubor: string; kurziva?: boolean };
const rodina = (balik: string, predpona: string, rezy: RezPisma[]) =>
  rezy.map((r) => ({
    path: `./node_modules/@expo-google-fonts/${balik}/${r.soubor}/${predpona}_${r.soubor}.ttf`,
    weight: r.vaha,
    style: (r.kurziva ? 'italic' : 'normal') as 'italic' | 'normal',
  }));
const PISMA_RDL = [
  { fontFamily: 'Archivo', fontDefinitions: rodina('archivo', 'Archivo', [
    { vaha: 400, soubor: '400Regular' }, { vaha: 500, soubor: '500Medium' },
    { vaha: 600, soubor: '600SemiBold' }, { vaha: 700, soubor: '700Bold' },
    { vaha: 700, soubor: '700Bold_Italic', kurziva: true },
    { vaha: 800, soubor: '800ExtraBold' }, { vaha: 800, soubor: '800ExtraBold_Italic', kurziva: true },
  ]) },
  { fontFamily: 'Inter', fontDefinitions: rodina('inter', 'Inter', [
    { vaha: 400, soubor: '400Regular' }, { vaha: 500, soubor: '500Medium' },
    { vaha: 600, soubor: '600SemiBold' }, { vaha: 700, soubor: '700Bold' }, { vaha: 800, soubor: '800ExtraBold' },
  ]) },
  { fontFamily: 'IBM Plex Mono', fontDefinitions: rodina('ibm-plex-mono', 'IBMPlexMono', [
    { vaha: 400, soubor: '400Regular' }, { vaha: 500, soubor: '500Medium' },
    { vaha: 600, soubor: '600SemiBold' }, { vaha: 700, soubor: '700Bold' },
  ]) },
];

/**
 * ⛔ UVNITŘ XCODE BUILDU MUSÍ BÝT ŘEČENO, ČÍ APPKA SE STAVÍ.
 *
 * Naměřeno 2026-08-20 na běžící appce: ruční `xcodebuild` nad workspace
 * `RIQidi` BEZ `AISHA_APP_VERSION_FILE` postavil appku jménem **AISHA
 * Dirigent** — dvě navzájem si odporující identity v jednom buildu, a nic
 * nezasáhlo. Brána `ios-build-identity` to nechytí, protože měří SKRIPTY,
 * a ruční příkaz je obchází.
 *
 * ⛔ PROČ SE NEPOROVNÁVÁ S CÍLEM XCODE (první, chybný pokus). Tenhle soubor
 * vyhodnocuje fáze `[CP-User] Generate app.config`, která je přilepená k PODU
 * `EXConstants`, ne k aplikačnímu cíli. Naměřeno v jejích exportech:
 *     TARGET_NAME=EXConstants   PROJECT_NAME=Pods   SRCROOT=.../ios/Pods
 * Jméno stavěné appky tam NENÍ V ŽÁDNÉ proměnné — porovnání s `brand.xcodeName`
 * proto padalo VŽDY a shodilo každý build. Měřidlo se nesmí ptát na to, co jeho
 * stanoviště nevidí.
 *
 * ⭐ CO ZMĚŘIT JDE: že jsme uvnitř Xcode buildu (`TARGET_NAME` existuje) a že
 * identita NEBYLA ŘEČENA. To je přesně ta vada — zapomenutá proměnná, ne špatná
 * hodnota. Platformní build je legitimní, ale musí se přiznat výslovně; táž
 * doktrína jako `EXPO_PUBLIC_KC_CLIENT_ID=aisha-app` v `instance-env-derive.sh`.
 */
if (process.env.TARGET_NAME && !process.env.AISHA_APP_VERSION_FILE
    && process.env.AISHA_PLATFORM_BUILD !== '1') {
  throw new Error(
    `app.config: XCODE STAVÍ, ALE NIKDO NEŘEKL ČÍ APPKU.\n` +
      `  AISHA_APP_VERSION_FILE není nastavená → použil by se platformní profil\n` +
      `  (${VERSION.app?.displayName ?? '?'}), tedy cizí jméno, ikona i OIDC klient.\n\n` +
      `CO S TIM:\n` +
      `  1) instanční build — nastav profil té appky:\n` +
      `       AISHA_APP_VERSION_FILE=<…>/<fork>-<appka>.version.json xcodebuild …\n` +
      `  2) platformní build — přiznej to VÝSLOVNĚ:\n` +
      `       AISHA_PLATFORM_BUILD=1 xcodebuild …`,
  );
}


// ── Firebase konfigurace: instanční soubory, obě platformy ──────────────────
// Dřív se hlídala JEN iOS varianta, takže na Androidu se Firebase nezapojil ani
// tehdy, když `google-services.json` na místě byl — a hlavně: pluginy se
// nenačetly vůbec, když chyběl iOS plist. Android build tak tiše vyjel bez pushe.
// Oba soubory jsou instanční (každá instance má vlastní projekt) a oba jsou
// v .gitignore.
// Cesty jdou přebít z prostředí, aby si instance mohla soubory držet u sebe a
// nemusela je kopírovat do stromu platformy — stejný princip jako u identity
// (`AISHA_APP_VERSION_FILE`). Bez toho by každá instance musela sahat na sdílený
// adresář a při přepnutí instance by tam zůstal soubor té předchozí.
const firebaseConfig = (envVar: string, vychozi: string) => {
  const raw = process.env[envVar];
  const cesta = raw ? path.resolve(raw) : path.join(__dirname, vychozi);
  return {
    // Expo chce cestu k souboru; absolutní je v pořádku a u instančních dat nutná.
    hodnota: raw ? cesta : `./${vychozi}`,
    existuje: fs.existsSync(cesta),
    cesta,
  };
};
/**
 * Ikony a splash — z BRANDU INSTANCE, ne přepisem souborů platformy.
 *
 * ⛔ JAK TO BYLO DO 2026-08-19. Instance „nasazovala" ikonu tím, že přepsala
 * `assets/icon.png` v pracovním stromě platformy. Poznalo se to podle 12
 * změněných binárek v `git status`, které tam trvale visely — a hlavně to
 * NEUNESE DVĚ APPKY Z JEDNOHO STROMU: RIQ Investments i RIQ Řidič by chtěly
 * týž soubor a druhý build by přebil první.
 *
 * ⭐ Cesta se proto bere z prostředí, stejně jako identita
 * (`AISHA_APP_VERSION_FILE`) a Firebase — jeden vzor pro všechno, co je
 * instanční. Brand si drží své obrázky u sebe, generované z jednoho masteru
 * (`<fork>-design/brand/build-brand.mjs` → `dist/`), a strom platformy zůstává čistý.
 *
 * Bez proměnné se použijí obrázky platformy — to není tichá domněnka, ale
 * legitimní build AISHY samotné.
 */
const brandAsset = (envVar: string, vychozi: string) => {
  const raw = process.env[envVar];
  if (!raw) return vychozi;
  const cesta = path.resolve(raw);
  // ⛔ Nastavená, ale neexistující cesta je CHYBA, ne „tak tedy výchozí ikona".
  // Kdo ji vyplnil, chtěl SVOU ikonu — tiché vynechání by vyrobilo appku
  // s cizím logem a poznalo by se to až v obchodě. Táž doktrína jako u Firebase.
  if (!fs.existsSync(cesta)) {
    throw new Error(`app.config: ${envVar} ukazuje na ${cesta}, ale soubor tam není.`);
  }
  return cesta;
};

/**
 * ⛔ PŘIPNUTÝ BUILD BEZ ADRESY BRÁNY JE CIHLA — a musí padnout TADY, ne v ruce řidiče.
 *
 * `brand.gatewayPinned` znamená „adresa je zapečená a přepínač v Settings se
 * SKRYJE" (viz `config/api.ts`). Bez `EXPO_PUBLIC_AISHA_GATEWAY_URL` tedy vznikne
 * appka, která se nemá kam připojit A NEJDE NIKAM NASMĚROVAT.
 *
 * Běhový hlídač sice existuje, ale hlásí „Open Settings to configure backend" —
 * tedy posílá člověka na obrazovku, kterou mu týž příznak schoval. Rada, kterou
 * nelze uposlechnout, je horší než žádná.
 *
 * Poznalo by se to až z TestFlightu, po nahrání do obchodu. Proto se to měří
 * při buildu: chybějící adresa u připnutého buildu ho ZASTAVÍ.
 */
if (VERSION.brand.gatewayPinned && !process.env.EXPO_PUBLIC_AISHA_GATEWAY_URL
    && !process.env.EXPO_PUBLIC_AISHA_POSTGREST_URL) {
  throw new Error(
    'app.config: ' + VERSION.app.displayName + ' má gatewayPinned=true, ale ' +
    'EXPO_PUBLIC_AISHA_GATEWAY_URL není nastavená.\n' +
    'Připnutý build skrývá přepínač v Settings, takže by vznikla aplikace, která ' +
    'se nemá kam připojit a nejde nikam nasměrovat — a poznalo by se to až z TestFlightu.',
  );
}

const APP_ICON = brandAsset('AISHA_APP_ICON', './assets/icon.png');
const APP_ADAPTIVE_ICON = brandAsset('AISHA_APP_ADAPTIVE_ICON', './assets/adaptive-icon.png');
const APP_SPLASH = brandAsset('AISHA_APP_SPLASH', './assets/splash.png');

const iosFirebase = firebaseConfig('AISHA_FIREBASE_IOS_FILE', 'GoogleService-Info.plist');
const androidFirebase = firebaseConfig('AISHA_FIREBASE_ANDROID_FILE', 'google-services.json');

// Nastavená, ale neexistující cesta je CHYBA, ne „tak tedy bez pushe". Kdo ji
// vyplnil, push chtěl — tiché vynechání by vyrobilo aplikaci, která vypadá
// hotově a notifikace v ní nechodí.
for (const [envVar, cfg] of [
  ['AISHA_FIREBASE_IOS_FILE', iosFirebase],
  ['AISHA_FIREBASE_ANDROID_FILE', androidFirebase],
] as const) {
  if (process.env[envVar] && !cfg.existuje) {
    throw new Error(`app.config: ${envVar} ukazuje na ${cfg.cesta}, ale soubor tam není.`);
  }
}

const IOS_FIREBASE_FILE = iosFirebase.hodnota;
const ANDROID_FIREBASE_FILE = androidFirebase.hodnota;
const hasIosFirebase = iosFirebase.existuje;
const hasAndroidFirebase = androidFirebase.existuje;
const hasAnyFirebase = hasIosFirebase || hasAndroidFirebase;

// Sentry target comes from version.json `brand` (env vars still override for CI).
// The old per-platform branches keyed on EAS_BUILD_PLATFORM, which is only set by
// EAS — this app is built locally via Xcode/Gradle, so those branches never ran.
const resolveSentryDsn = (): string | undefined => process.env.EXPO_PUBLIC_SENTRY_DSN;
const resolveSentryProject = (): string =>
  process.env.SENTRY_PROJECT || VERSION.brand.sentry.project;

// ============================================================================
// Expo Configuration
// ============================================================================

export default ({ config }: ConfigContext): ExpoConfig => {
  const sentryDsn = resolveSentryDsn();
  const sentryUrl = extractSentryUrlFromDsn(sentryDsn);
  const firebasePlugins = hasAnyFirebase
    ? ['@react-native-firebase/app', '@react-native-firebase/messaging']
    : [];

  return {
    ...config,
    name: VERSION.app.displayName,
    slug: VERSION.brand.slug,
    version: VERSION.version,
    orientation: orientaceObrazovky(VERSION.brand.orientation),
    icon: APP_ICON,
    userInterfaceStyle: 'automatic',
    scheme: VERSION.brand.scheme,
    newArchEnabled: true,

    splash: {
      image: APP_SPLASH,
      resizeMode: 'contain',
      backgroundColor: VERSION.brand.backgroundColor, // matches the design-tokens mobile background
    },

    ios: {
      supportsTablet: true,
      bundleIdentifier: VERSION.app.bundleId,
      buildNumber: String(VERSION.ios.buildNumber),
      ...(hasIosFirebase ? { googleServicesFile: IOS_FIREBASE_FILE } : {}),
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        NSFaceIDUsageDescription: 'Used for secure app unlock',
        // Required by Apple even if unused: bundled SDKs (WebRTC) reference these APIs,
        // so App Store processing (ITMS-90683) demands a purpose string for each.
        NSCameraUsageDescription: 'The app uses the camera to capture photos and documents you attach to records.',
        NSMicrophoneUsageDescription: 'The app uses the microphone for in-app voice features and calls.',
        NSPhotoLibraryUsageDescription: 'The app accesses your photo library so you can attach images to records.',
        ITSAppUsesNonExemptEncryption: false,
        LSApplicationCategoryType: VERSION.app.category,
        UIBackgroundModes: ['fetch', 'remote-notification'],
      },
    },

    android: {
      adaptiveIcon: {
        foregroundImage: APP_ADAPTIVE_ICON,
        backgroundColor: VERSION.brand.backgroundColor, // adaptive-icon padded to safe zone
      },
      package: VERSION.app.bundleId,
      // ⛔ ŽÁDNÁ CLOUDOVÁ ZÁLOHA. Výchozí hodnota je `true`, takže do dneška
      // odcházela offline fronta — jméno přejímajícího, jeho PODPIS, poznámky —
      // do zálohy zařízení. Podpis je osobní údaj TŘETÍ osoby a právní důkaz
      // pro fakturaci; do cizí zálohy nepatří ani zamčený.
      //
      // ⭐ PÁR S `WHEN_UNLOCKED_THIS_DEVICE_ONLY` U KLÍČE (services/trezorStore).
      // Samo o sobě by tohle nestačilo (iOS zálohu má vlastní) a samo o sobě by
      // nestačilo ani to druhé. Dohromady platí: šifrotext se ven dostat může,
      // KLÍČ NIKDY — a bez klíče je záloha k ničemu.
      //
      // ⚠️ Cena je vědomá: přenos na nové zařízení frontu NEPŘENESE. Právě proto
      // umí appka rozlišit „nečitelné" od „prázdné" a nikdy to nepřepíše.
      allowBackup: false,
      ...(hasAndroidFirebase ? { googleServicesFile: ANDROID_FIREBASE_FILE } : {}),
      versionCode: VERSION.android.versionCode,
      permissions: [
        'INTERNET',
        'USE_BIOMETRIC',
        'USE_FINGERPRINT',
        'RECEIVE_BOOT_COMPLETED',
        'VIBRATE',
        'POST_NOTIFICATIONS',
        // Fotky předání (EvidencePhotos → launchCameraAsync). Dřív ji do manifestu
        // nesl jen expo-image-picker ze své knihovny; appka, která fotí evidenci,
        // má fotoaparát deklarovat sama, ne spoléhat na slučování manifestů.
        'CAMERA',
        // Poloha tabletu u potvrzení předání (lib/polohaZarizeni). Jen v popředí:
        // sledování trasy na pozadí je samostatné rozhodnutí se svým formulářem
        // pro Google Play, tady se nepřidává.
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
      ],
    },

    web: {
      favicon: './assets/favicon.png',
    },

    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-localization',
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Used for secure app unlock',
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: VERSION.ios.deploymentTarget,
            useFrameworks: 'static',
          },
          android: {
            minSdkVersion: VERSION.android.minSdkVersion,
            targetSdkVersion: VERSION.android.targetSdkVersion,
            compileSdkVersion: VERSION.android.targetSdkVersion,
          },
        },
      ],
      ...firebasePlugins,
      [
        '@sentry/react-native/expo',
        {
          url: sentryUrl || VERSION.brand.sentry.url,
          organization: process.env.SENTRY_ORG || VERSION.brand.sentry.organization,
          project: resolveSentryProject(),
        },
      ],
      ['expo-font', {
        android: { fonts: PISMA_RDL },
        ios: { fonts: PISMA_RDL.flatMap((r) => r.fontDefinitions.map((d) => d.path)) },
      }],
      './plugins/withSentryAuth.js',
      './plugins/withGoogleServicesFile.js',
      './plugins/withFirebaseNotificationFix.js',
      './plugins/withBuildSettings.js',
      './plugins/withRemoveAdId.js',
      // Release build podepsaný vlastním klíčem z prostředí — bez něj Play build odmítne.
      './plugins/withReleaseSigning.js',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Your location is attached to a delivery handover as supporting place information.',
          isAndroidBackgroundLocationEnabled: false,
          isIosBackgroundLocationEnabled: false,
        },
      ],
    ],

    extra: {
      EXPO_PUBLIC_AISHA_GATEWAY_URL:
        process.env.EXPO_PUBLIC_AISHA_GATEWAY_URL ?? process.env.EXPO_PUBLIC_AISHA_POSTGREST_URL,
      // Dedicated company build → gateway is fixed (Settings switcher hidden, stored
      // override ignored). Umbrella build (default) → user may switch at runtime.
      AISHA_GATEWAY_PINNED: VERSION.brand.gatewayPinned,
      // Short brand token for in-app i18n {{brand}} interpolation (full name is
      // Constants.expoConfig.name). Drives all in-app product copy per reskin.
      AISHA_BRAND_SHORT: VERSION.brand.shortName,
      // The AI assistant's own name for i18n {{assistant}} — instance-defined.
      AISHA_ASSISTANT_NAME: VERSION.brand.assistantName,
      // Post-login default surface: 'tabs' (member home) or the SLUG of an
      // extranet section — 'porada' (daily brief), 'vyvoz' (driver's tape),
      // 'meridla' (meter round). Non-admin/staff only; roles still see tabs
      // first. Brand data, not code: an instance flips it in ITS version.json.
      AISHA_DEFAULT_SURFACE: VERSION.brand.defaultSurface ?? 'tabs',
      // Which SLICE of the app this build ships (absent = umbrella, everything).
      // One dedicated app per purpose out of one codebase — see src/config/profile.ts.
      AISHA_APP_SECTIONS: VERSION.brand.appSlice?.sections,
      AISHA_APP_TABS: VERSION.brand.appSlice?.tabs,
      // Slovník instance: čím se v TÉHLE appce věci jmenují („Moje dodávky"
      // místo „Moje kroky"). PŘEPISUJE existující klíče, nezavádí nové —
      // překlep zastaví build výš v `overSlovnik`. Viz src/config/slovnik.ts.
      AISHA_I18N_SLOVNIK: VERSION.brand.slovnik,
      // Slovník instance (i18n.json vedle version.json): klíče bloků a sekcí, které
      // platforma nezná. DOPLŇUJE katalog, nepřepisuje ho — viz loadInstanceI18n.
      AISHA_I18N_INSTANCE: INSTANCE_I18N,
      // Jazyk ESDK: brand a téma pro EsdkProvider (src/extranet/esdk.tsx).
      AISHA_ESDK_BRAND: VERSION.brand.esdk?.brand ?? VERSION.brand.slug,
      AISHA_ESDK_THEME: VERSION.brand.esdk?.theme ?? 'noc',
      EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY:
        process.env.EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY ?? process.env.EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY,
      EXPO_PUBLIC_REDIRECT_URL: process.env.EXPO_PUBLIC_REDIRECT_URL,
      // Keycloak OIDC. config/oidc.ts looks these up dynamically (process.env[key]),
      // which the Expo babel plugin does not inline — `extra` is the only path that
      // reaches a release bundle. Without them the authority resolves empty.
      EXPO_PUBLIC_KC_AUTHORITY: process.env.EXPO_PUBLIC_KC_AUTHORITY,
      EXPO_PUBLIC_KC_REALM: process.env.EXPO_PUBLIC_KC_REALM,
      EXPO_PUBLIC_KC_CLIENT_ID: process.env.EXPO_PUBLIC_KC_CLIENT_ID,
      // Dveře (SPA). Bez VŠECH čtyř se obrazovka „Zaklepat" nenabídne a řekne,
      // co chybí — ťukat naslepo nemá smysl: dveře mlčí i při úspěchu, takže
      // zaťukání na uhodnutou adresu, port nebo `kid` vypadá stejně jako
      // zaťukání správné. `kid` navíc vstupuje do odvození klíče, ne jen do
      // adresace, a `scope` se musí shodovat s rosterem (jinak `scope-denied`,
      // což je zvenčí k nerozeznání od špatného hesla).
      EXPO_PUBLIC_KNOCK_HOST: process.env.EXPO_PUBLIC_KNOCK_HOST,
      EXPO_PUBLIC_KNOCK_PORT: process.env.EXPO_PUBLIC_KNOCK_PORT,
      EXPO_PUBLIC_KNOCK_KID: process.env.EXPO_PUBLIC_KNOCK_KID,
      EXPO_PUBLIC_KNOCK_SCOPE: process.env.EXPO_PUBLIC_KNOCK_SCOPE,
      EXPO_PUBLIC_PUBLIC_TLD: process.env.EXPO_PUBLIC_PUBLIC_TLD,
      // Deprecated aliases — config/api.ts still reads them dynamically as a
      // fallback, so they need forwarding like every other dynamic lookup.
      EXPO_PUBLIC_AISHA_POSTGREST_URL: process.env.EXPO_PUBLIC_AISHA_POSTGREST_URL,
      EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY: process.env.EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY,
      // Self-config discovery — config/api.ts derives BOOTSTRAP_URL from these.
      EXPO_PUBLIC_BOOTSTRAP_URL: process.env.EXPO_PUBLIC_BOOTSTRAP_URL,
      EXPO_PUBLIC_APP_URL: process.env.EXPO_PUBLIC_APP_URL,
      EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
      EXPO_PUBLIC_LIVEKIT_URL: process.env.EXPO_PUBLIC_LIVEKIT_URL,
      EXPO_PUBLIC_SENTRY_DSN: sentryDsn,
      EXPO_PUBLIC_SENTRY_ENV: process.env.EXPO_PUBLIC_SENTRY_ENV,
      EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER,
    },

    updates: {
      url: process.env.EXPO_UPDATES_URL,
    },

    runtimeVersion: {
      policy: 'sdkVersion',
    },
  };
};
