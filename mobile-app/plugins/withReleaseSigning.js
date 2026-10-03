/**
 * Expo Config Plugin: release build podepsaný VLASTNÍM klíčem, ne ladicím.
 *
 * ⛔ PROČ VZNIKL (NAMĚŘENO 2026-09-18). Šablona React Native dává release buildu
 * `signingConfig signingConfigs.debug` — a nikdo to nepřepsal. Každé APK, které
 * tahle appka kdy vydala (i do Firebase), je proto podepsané klíčem
 * `CN=Android Debug` z `android/app/debug.keystore` ŠABLONY, tedy klíčem, který
 * má každý, kdo si šablonu stáhne. Dvě důsledky:
 *   · Google Play build podepsaný ladicím klíčem ODMÍTNE — vydání na Play
 *     tudy vůbec nevede.
 *   · Android pustí „aktualizaci" od KOHOKOLI, kdo podepíše APK týmž
 *     veřejným klíčem. U appky rozdávané mimo obchod je to otevřené okno.
 * `.env.build.example` přitom `ANDROID_KEYSTORE_*` vyjmenovával — ale žádný
 * kód je nečetl. Deklarace bez čtenáře vypadá úplně stejně jako zapojení.
 *
 * ⭐ TAJEMSTVÍ SE DO SOUBORU NEPÍŠE. Plugin do `build.gradle` vloží jen čtení
 * z prostředí při sestavení (`System.getenv`), takže heslo ani cesta nikdy
 * neleží ve vygenerovaném projektu.
 *
 * ⭐ BEZ KLÍČE ZŮSTÁVÁ LADICÍ PODPIS — ale jen pro APK na testy, a nahlas.
 * O tom, jestli smí vzniknout build pro Play, rozhoduje `build-android.sh`
 * (fail-closed) a kontrola podpisu hotového artefaktu, ne tenhle plugin.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

/** Značka, podle které se pozná, že už je `build.gradle` upravený. */
const ZNACKA = '// [withReleaseSigning]';

/** Proměnné prostředí, ze kterých se klíč čte. Jména drží `.env.build.example`. */
const PROMENNE = Object.freeze({
  cesta: 'ANDROID_KEYSTORE_PATH',
  alias: 'ANDROID_KEYSTORE_ALIAS',
  hesloUloziste: 'ANDROID_KEYSTORE_PASSWORD',
  hesloKlice: 'ANDROID_KEY_PASSWORD',
});

const RADEK_LADICI = 'signingConfig signingConfigs.debug';

/**
 * Vrátí `build.gradle` s release podpisem z prostředí, nebo `null`, když už
 * upravený je.
 *
 * Čistá funkce schválně: chování se dá změřit bez prebuildu a Gradle — test
 * měří VÝSLEDEK, ne to, že se v pluginu vyskytuje nějaké slovo.
 *
 * ⛔ Chybějící kotva v šabloně = výjimka. Tichý návrat by znamenal, že release
 * build zůstane podepsaný ladicím klíčem a nikdo se to nedozví.
 */
function zapojReleasePodpis(gradle) {
  if (gradle.includes(ZNACKA)) return null;

  const signingConfigs = gradle.indexOf('signingConfigs {');
  if (signingConfigs === -1) throw new Error(`${ZNACKA} build.gradle nemá blok signingConfigs — šablona se změnila`);

  const buildTypes = gradle.indexOf('buildTypes {', signingConfigs);
  if (buildTypes === -1) throw new Error(`${ZNACKA} build.gradle nemá blok buildTypes — šablona se změnila`);
  const release = gradle.indexOf('release {', buildTypes);
  if (release === -1) throw new Error(`${ZNACKA} buildTypes nemá release — šablona se změnila`);
  const ladici = gradle.indexOf(RADEK_LADICI, release);
  if (ladici === -1) throw new Error(`${ZNACKA} release build nepodepisuje ladicím klíčem — šablona se změnila, zkontroluj ručně`);

  const env = (jmeno) => `System.getenv('${jmeno}')`;
  const blokRelease =
    `\n        release {\n` +
    `            ${ZNACKA} klíč se čte z prostředí při sestavení, do souboru se nic nepíše\n` +
    `            if (${env(PROMENNE.cesta)}) {\n` +
    `                storeFile file(${env(PROMENNE.cesta)})\n` +
    `                storePassword ${env(PROMENNE.hesloUloziste)}\n` +
    `                keyAlias ${env(PROMENNE.alias)}\n` +
    `                keyPassword ${env(PROMENNE.hesloKlice)}\n` +
    `            }\n` +
    `        }`;
  const vyber =
    `${ZNACKA} bez klíče zůstává ladicí podpis — jen pro testovací APK, build pro Play ho odmítne\n` +
    `            signingConfig ${env(PROMENNE.cesta)} ? signingConfigs.release : signingConfigs.debug`;

  // Pořadí: nejdřív náhrada ve buildTypes (je dál v souboru), pak vložení
  // do signingConfigs — vložení by jinak posunulo index nalezeného řádku.
  const poVyberu = gradle.slice(0, ladici) + vyber + gradle.slice(ladici + RADEK_LADICI.length);
  const vlozit = signingConfigs + 'signingConfigs {'.length;
  return poVyberu.slice(0, vlozit) + blokRelease + poVyberu.slice(vlozit);
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(`${ZNACKA} build.gradle není groovy (${cfg.modResults.language}) — neumím ho upravit`);
    }
    const upraveny = zapojReleasePodpis(cfg.modResults.contents);
    if (upraveny !== null) cfg.modResults.contents = upraveny;
    return cfg;
  });

module.exports = withReleaseSigning;
module.exports.zapojReleasePodpis = zapojReleasePodpis;
module.exports.PROMENNE = PROMENNE;
module.exports.ZNACKA = ZNACKA;
