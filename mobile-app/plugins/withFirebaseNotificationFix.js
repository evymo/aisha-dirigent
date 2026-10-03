/**
 * Placeholder plugin for Firebase notification color conflict.
 * Actual fix is done by scripts/post-prebuild-android.sh.
 */
function withFirebaseNotificationFix(config) {
  console.log('[withFirebaseNotificationFix] Reminder: Run post-prebuild-android.sh after prebuild');
  return config;
}

module.exports = withFirebaseNotificationFix;
