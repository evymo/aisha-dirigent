/**
 * Expo Config Plugin for iOS Build Settings.
 * Handles dSYM generation and Podfile configuration.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * React Native CORE is built from source (dSYMs — crashes in React code stay
 * symbolicated in Sentry). React Native's VENDORED C++ is not: see
 * `RCT_USE_RN_DEP` in scripts/build-ios.sh for why those are two decisions and
 * not one.
 */
/** Značka, podle které se pozná, že už jsme Podfile upravili. */
const ZNACKA_RN_DEP = '# [withBuildSettings] RCT_USE_RN_DEP';

/**
 * Vrátí Podfile s vynuceným `RCT_USE_RN_DEP`, nebo `null`, když už tam je.
 *
 * Čistá funkce schválně: chování se pak dá změřit bez prebuildu, souborů
 * a Xcode — a test měří VÝSLEDEK, ne to, že se v pluginu vyskytuje nějaké
 * slovo.
 */
function zajistiRctUseRnDep(podfile) {
  if (podfile.includes(ZNACKA_RN_DEP)) return null;
  return (
    `${ZNACKA_RN_DEP} — vendored C++ (folly, glog, boost, fmt) z hotových\n` +
    `${ZNACKA_RN_DEP} artefaktů i při jádru ze zdrojů. Bez toho se fmt\n` +
    `${ZNACKA_RN_DEP} kompiluje lokálním Clangem a na Xcode 26 neprojde.\n` +
    `ENV['RCT_USE_RN_DEP'] ||= '1'\n\n${podfile}`
  );
}

const withBuildSettings = (config, props = {}) => {
  const { buildFromSource = true, generateDsym = true } = props;

  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const iosPath = path.join(projectRoot, 'ios');

      // Update Podfile.properties.json
      const podfilePropsPath = path.join(iosPath, 'Podfile.properties.json');
      let podfileProps = { 'expo.jsEngine': 'hermes' };

      if (fs.existsSync(podfilePropsPath)) {
        try {
          podfileProps = JSON.parse(fs.readFileSync(podfilePropsPath, 'utf8'));
        } catch (_e) {
          console.warn('[withBuildSettings] Could not parse Podfile.properties.json');
        }
      }

      if (buildFromSource) {
        podfileProps['ios.buildReactNativeFromSource'] = 'true';
        console.log('[withBuildSettings] React Native core from source (dSYM generation)');
      }

      // Vendored C++ (folly, glog, boost, fmt) still comes from React Native's
      // published artifacts. This has to be set HERE and not only in
      // scripts/build-ios.sh: the generated Podfile derives both prebuilt
      // channels from the property above, so with core-from-source it never
      // sets either, and `expo run:ios` — which never sources that script —
      // would go back to compiling fmt against whatever compiler Xcode ships.
      // Set on process.env because `pod install` runs as a child of prebuild
      // and inherits it; the Podfile uses `||=`, so our value wins.
      process.env.RCT_USE_RN_DEP = process.env.RCT_USE_RN_DEP ?? '1';
      console.log(`[withBuildSettings] Vendored C++ from prebuilt artifacts (RCT_USE_RN_DEP=${process.env.RCT_USE_RN_DEP})`);

      podfileProps['EX_DEV_CLIENT_NETWORK_INSPECTOR'] = 'true';
      fs.writeFileSync(podfilePropsPath, JSON.stringify(podfileProps, null, 2));
      console.log('[withBuildSettings] Updated Podfile.properties.json');

      /**
       * ⛔ `process.env` VÝŠE NESTAČÍ — ŽIJE JEN V PROCESU PREBUILDU.
       *
       * `pod install` spuštěný ručně (běžná věc: po `git pull`, po změně
       * závislosti, při ladění) je jiný proces a proměnnou nezdědí. Podfile
       * si ji sám nenastaví, protože obě prebuilt cesty odvozuje z jediné
       * vlastnosti `ios.buildReactNativeFromSource` — a tu držíme na 'true'
       * kvůli dSYM. Vendored C++ se pak vezme ZE ZDROJŮ a `fmt` se kompiluje
       * tím Clangem, který zrovna Xcode přinese.
       *
       * NAMĚŘENO 2026-09-06 (Xcode 26.6, Clang 17F113): pět chyb
       * `call to consteval function … is not a constant expression`
       * v `Pods/fmt/include/fmt/format-inl.h`. Pád je daleko od příčiny
       * a vypadá jako vada fmt nebo Xcode. Po `pod install` s proměnnou
       * zmizel `Pods/fmt` úplně (14 souborů → 0, „Using release tarball").
       *
       * Proto hodnota dostává JEDEN TRVALÝ DOMOV v souboru, který `pod
       * install` opravdu čte. `||=` v Podfile respektuje toho, kdo si
       * proměnnou nastaví sám.
       */
      const podfilePath = path.join(iosPath, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        // Fail-closed: tiché přeskočení je přesně to, co tuhle vadu vyrobilo.
        throw new Error(
          `[withBuildSettings] Podfile nenalezen na ${podfilePath} — ` +
            'nelze zajistit RCT_USE_RN_DEP pro ruční `pod install`.'
        );
      }
      const podfile = fs.readFileSync(podfilePath, 'utf8');
      const upraveny = zajistiRctUseRnDep(podfile);
      if (upraveny !== null) {
        fs.writeFileSync(podfilePath, upraveny);
        console.log('[withBuildSettings] RCT_USE_RN_DEP zapsán do Podfile (přežije ruční pod install)');
      }

      return config;
    },
  ]);
};

module.exports = withBuildSettings;
module.exports.zajistiRctUseRnDep = zajistiRctUseRnDep;
module.exports.ZNACKA_RN_DEP = ZNACKA_RN_DEP;
