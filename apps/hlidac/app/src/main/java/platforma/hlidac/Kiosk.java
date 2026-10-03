package platforma.hlidac;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import java.util.ArrayList;
import java.util.List;

/** Kiosková aplikace instance: je nainstalovaná, má oprávnění, běží v zámku. */
final class Kiosk {
    private Kiosk() {}

    /** Verze kioskové aplikace, nebo null, když chybí. */
    static String verze(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(BuildConfig.KIOSK_PACKAGE, 0);
            return pi.versionName + " (" + pi.getLongVersionCode() + ")";
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    /**
     * Oprávnění předem a zákaz odinstalace. Volá se před KAŽDÝM spuštěním:
     * po aktualizaci z Obchodu Play může aplikace chtít nové oprávnění a
     * řidič v kiosku nemá kde ho povolit.
     */
    static List<String> pripravAplikaci(Context ctx) {
        List<String> zprava = new ArrayList<>();
        if (verze(ctx) == null) {
            zprava.add("✗ " + BuildConfig.KIOSK_PACKAGE + " není nainstalovaná");
            return zprava;
        }
        DevicePolicyManager dpm = Politika.dpm(ctx);
        ComponentName a = Politika.admin(ctx);
        for (String o : BuildConfig.KIOSK_PERMISSIONS) {
            String kratce = o.substring(o.lastIndexOf('.') + 1);
            boolean ok;
            try {
                ok = dpm.setPermissionGrantState(a, BuildConfig.KIOSK_PACKAGE, o,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
            } catch (RuntimeException e) {
                zprava.add("✗ " + kratce + ": " + e.getMessage());
                continue;
            }
            // false = aplikace oprávnění nedeklaruje (nebo ho systém správci nedovolí udělit).
            zprava.add((ok ? "✓ " : "✗ ") + kratce + (ok ? "" : ": aplikace ho nedeklaruje?"));
        }
        Politika.krok(zprava, "odinstalace zakázána", () -> dpm.setUninstallBlocked(a, BuildConfig.KIOSK_PACKAGE, true));
        return zprava;
    }

    /** Spustí aplikaci v zámku. False = není co spustit. */
    static boolean spust(Activity odkud) {
        Intent spust = odkud.getPackageManager().getLaunchIntentForPackage(BuildConfig.KIOSK_PACKAGE);
        if (spust == null) return false;
        pripravAplikaci(odkud);
        ActivityOptions volby = ActivityOptions.makeBasic();
        volby.setLockTaskEnabled(true);
        spust.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        odkud.startActivity(spust, volby.toBundle());
        return true;
    }
}
