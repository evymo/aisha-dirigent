/**
 * Expo config plugin to remove AD_ID permission from Android manifest.
 * Required for privacy-focused apps that don't use advertising.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withRemoveAdId(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const existing = manifest['uses-permission'].find(
      (perm) => perm.$?.['android:name'] === 'com.google.android.gms.permission.AD_ID'
    );

    if (existing) {
      existing.$['tools:node'] = 'remove';
    } else {
      manifest['uses-permission'].unshift({
        $: {
          'android:name': 'com.google.android.gms.permission.AD_ID',
          'tools:node': 'remove',
        },
      });
    }

    return config;
  });
};
