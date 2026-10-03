/**
 * Expo Config Plugin: withGoogleServicesFile
 *
 * Copies GoogleService-Info.plist into the generated iOS project during prebuild.
 * The source file must exist at mobile-app/GoogleService-Info.plist.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function copyIfPresent(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function withGoogleServicesFile(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const iosProjectRoot = modConfig.modRequest.platformProjectRoot;
      const sourcePath = path.join(projectRoot, 'GoogleService-Info.plist');
      // iOS target dir = version.json brand.xcodeName (displayName minus non-alphanumerics),
      // so a re-skinned build drops the plist into the right folder without editing this plugin.
      let appName = 'AISHADirigent';
      try {
        const v = JSON.parse(fs.readFileSync(path.join(projectRoot, 'version.json'), 'utf8'));
        if (v.brand && v.brand.xcodeName) appName = v.brand.xcodeName;
      } catch {
        // version.json unreadable — keep the default; prebuild will still produce that target.
      }

      const copiedRoot = copyIfPresent(
        sourcePath,
        path.join(iosProjectRoot, 'GoogleService-Info.plist')
      );
      const copiedApp = copyIfPresent(
        sourcePath,
        path.join(iosProjectRoot, appName, 'GoogleService-Info.plist')
      );

      if (!copiedRoot && !copiedApp) {
        console.warn(
          '[withGoogleServicesFile] GoogleService-Info.plist not found in mobile-app root. '
          + 'Place the Firebase iOS config there before prebuild.'
        );
      } else {
        console.log('[withGoogleServicesFile] GoogleService-Info.plist copied into iOS project');
      }

      return modConfig;
    },
  ]);
}

module.exports = withGoogleServicesFile;
