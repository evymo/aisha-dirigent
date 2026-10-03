package platforma.hlidac;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/** Správce zařízení. Starší cesta provisioningu (před Androidem 12) končí tady. */
public class SpravceReceiver extends DeviceAdminReceiver {
    @Override
    public void onProfileProvisioningComplete(Context ctx, Intent intent) {
        Zavedeni.dokonci(ctx, intent);
    }
}
