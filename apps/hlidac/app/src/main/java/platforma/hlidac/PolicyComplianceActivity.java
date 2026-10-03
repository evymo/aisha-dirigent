package platforma.hlidac;

import android.app.Activity;
import android.os.Bundle;

/** Android 12+: poslední krok nastavení z QR — tady hlídač převezme tablet. */
public class PolicyComplianceActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Zavedeni.dokonci(this, getIntent());
        setResult(RESULT_OK);
        finish();
    }
}
