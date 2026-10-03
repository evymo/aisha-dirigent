package platforma.hlidac;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.List;

/**
 * Domovská obrazovka hlídače. Stavy:
 *
 *   SERVIS    — technik: instalace z Obchodu Play, Wi-Fi, nastavení, zapnutí kiosku.
 *   ODPOČET   — pár vteřin před spuštěním kioskové aplikace. Tady (po restartu
 *               tabletu) vede jediná cesta ven: 7× ťuknout na název (nebo na
 *               text odpočtu) a zadat PIN technika. Obrazovka to sama říká.
 *   OKNO      — noční aktualizace; aplikace je v pozadí, aby ji Obchod Play smí aktualizovat.
 *   CHYBÍ     — kiosková aplikace není nainstalovaná.
 *
 * Mimo servis běží v zámku (lock task) i hlídač sám, takže ani během odpočtu
 * nejde stáhnout lištu a odejít do nastavení.
 */
public class DomovActivity extends Activity {
    /**
     * ⛔ NAMĚŘENO 2026-09-25 na tabletu v terénu: s 5 s se do servisu nedostal ani
     * majitel. Okno otevírá jen restart, a na Samsungu podržení bočního tlačítka
     * v kiosku často nic neudělá (Bixby), takže zbývá vynucený restart (boční +
     * ztlumení ~10 s). Než technik po logu zjistí, kam ťukat, 5 s uplyne. Bezpečnost
     * délka nenese — tu drží PIN a zámek po chybných pokusech.
     */
    private static final int ODPOCET_S = 15;
    private static final int TUKNUTI = 7;
    private static final long TUKNUTI_OKNO_MS = 4000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Nastaveni nastaveni;
    private LinearLayout obsah;
    private TextView nadpis;
    private TextView stav;
    private TextView zprava;
    private int tuknuti;
    private long prvniTuknuti;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        nastaveni = new Nastaveni(this);

        LinearLayout sloupec = new LinearLayout(this);
        sloupec.setOrientation(LinearLayout.VERTICAL);
        int okraj = (int) (24 * getResources().getDisplayMetrics().density);
        sloupec.setPadding(okraj, okraj, okraj, okraj);

        nadpis = new TextView(this);
        nadpis.setText(getString(R.string.app_name));
        nadpis.setTextSize(28);
        nadpis.setOnClickListener(v -> tuknutiNaNadpis());
        sloupec.addView(nadpis);

        stav = new TextView(this);
        stav.setTextSize(18);
        stav.setPadding(0, okraj / 2, 0, okraj / 2);
        // Druhý, velký cíl pro vstup do servisu: nadpis je jediný řádek nahoře a
        // tam se o místo přetahuje se systémovou lištou. PIN hlídá dál.
        stav.setOnClickListener(v -> tuknutiNaNadpis());
        sloupec.addView(stav);

        obsah = new LinearLayout(this);
        obsah.setOrientation(LinearLayout.VERTICAL);
        sloupec.addView(obsah);

        zprava = new TextView(this);
        zprava.setTypeface(Typeface.MONOSPACE);
        zprava.setTextSize(12);
        zprava.setPadding(0, okraj, 0, 0);
        sloupec.addView(zprava);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(sloupec);
        // ⛔ NAMĚŘENO 2026-09-28: tablety v terénu jsou na Androidu 16 a ten appce
        //    s targetSdk 36 vnutí kreslení od okraje k okraji BEZ možnosti se z něj
        //    vyvázat. Obsah pak začínal pod stavovou lištou (kterou kiosk ukazuje,
        //    LOCK_TASK_FEATURE_SYSTEM_INFO) a ta si brala ťuknutí na nadpis — do
        //    servisu se nedalo dostat a tablet nešel odblokovat. Okraje proto
        //    odsazuje sama obrazovka podle lišt a výřezu displeje.
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        vykresli();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacksAndMessages(null);
    }

    @Override
    public void onBackPressed() {
        // Domovská obrazovka nemá kam zpět; v kiosku by „zpět“ jen blikalo.
    }

    private void vykresli() {
        handler.removeCallbacksAndMessages(null);
        obsah.removeAllViews();
        if (!Politika.jsemSpravce(this)) {
            stav.setText(getString(R.string.stav_neni_spravce));
            return;
        }
        if (nastaveni.servis()) {
            ukonciZamek();
            vykresliServis();
            return;
        }
        zamkni();
        if (nastaveni.vOkne()) {
            stav.setText(getString(R.string.okno_aktualizace, nastaveni.okno().konec.toString()));
            obsah.addView(tlacitko(getString(R.string.spustit_hned), () -> {
                nastaveni.nastavVOkne(false);
                spustKiosk();
            }));
            return;
        }
        if (Kiosk.verze(this) == null) {
            // Bez appky by tablet jen stál s „chybí" a nikdo by nevěděl proč —
            // ukáže se, na čem rozdávání skončilo, a dá se to zkusit znovu.
            Button akt = tlacitkoAktualizace();
            obsah.addView(akt);
            Runnable obnov = new Runnable() {
                @Override public void run() {
                    stav.setText(getString(R.string.aplikace_chybi, BuildConfig.KIOSK_PACKAGE) + "\n" + posledniKrok());
                    akt.setEnabled(!Rozdavani.bezi());
                    akt.setText(getString(Rozdavani.bezi() ? R.string.aktualizuji : R.string.aktualizovat_ted));
                    if (Kiosk.verze(DomovActivity.this) != null) vykresli();
                    else handler.postDelayed(this, 2000);
                }
            };
            obnov.run();
            return;
        }
        odpocet(ODPOCET_S);
    }

    /** Diagnostika servisu — co technik potřebuje vidět, když appka nedorazí. */
    private String textServisu() {
        String verze = Kiosk.verze(this);
        StringBuilder sb = new StringBuilder(getString(R.string.servis_nadpis));
        sb.append("\n").append(verze == null
            ? getString(R.string.aplikace_chybi, BuildConfig.KIOSK_PACKAGE)
            : getString(R.string.aplikace_verze, BuildConfig.KIOSK_PACKAGE, verze));
        sb.append("\n").append(getString(R.string.diag_hlidac, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE));
        String nabidka = nastaveni.nabidka();
        sb.append("\n").append(nabidka == null || nabidka.isEmpty()
            ? getString(R.string.diag_nabidka_nic) : getString(R.string.diag_nabidka, nabidka));
        Vybava v = Vybava.zNastaveni(nastaveni);
        sb.append("\n").append(v == null ? getString(R.string.diag_api_chybi) : getString(R.string.diag_api, v.apiUrl));
        if (!nastaveni.maPlatnyPin()) sb.append("\n").append(getString(R.string.chybi_pin));
        sb.append("\n").append(getString(R.string.okno_info, nastaveni.okno().toString()));
        String vadaOkna = nastaveni.odmitnuteOkno();
        if (vadaOkna != null) sb.append("\n").append(getString(R.string.okno_odmitnuto, vadaOkna, nastaveni.okno().toString()));
        // Architektura je diagnostika, ne ozdoba: Řidič se staví jen pro arm64 a na
        // 32bitovém Androidu by instalace skončila INSTALL_FAILED_NO_MATCHING_ABIS.
        String abi = Build.SUPPORTED_64_BIT_ABIS.length > 0 ? Build.SUPPORTED_64_BIT_ABIS[0] : Build.SUPPORTED_ABIS[0] + " (32 bit)";
        sb.append("\n").append(getString(R.string.diag_zarizeni, Build.VERSION.RELEASE, Build.MODEL, abi));
        String webView = Politika.webView();
        sb.append("\n").append(webView == null ? getString(R.string.diag_webview_chybi) : getString(R.string.diag_webview, webView));
        sb.append("\n").append(posledniKrok());
        return sb.toString();
    }

    private String posledniKrok() {
        String k = nastaveni.stavRozdavani();
        return k == null ? getString(R.string.diag_posledni_nic) : getString(R.string.diag_posledni, k);
    }

    private Button tlacitkoAktualizace() {
        Button b = tlacitko(getString(R.string.aktualizovat_ted), () -> {
            final android.content.Context app = getApplicationContext();
            new Thread(() -> Rozdavani.zkusAktualizovat(app), "hlidac-aktualizace-ted").start();
        });
        b.setEnabled(!Rozdavani.bezi());
        return b;
    }

    private void vykresliServis() {
        String verze = Kiosk.verze(this);
        stav.setText(textServisu());
        Button akt = tlacitkoAktualizace();
        obsah.addView(akt);
        // Živě: průběh stahování a výsledek instalace přicházejí z jiného vlákna.
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                // Appka právě dorazila → překreslit celé (povolí se „spustit kiosk").
                if (verze == null && Kiosk.verze(DomovActivity.this) != null) {
                    vykresli();
                    return;
                }
                stav.setText(textServisu());
                akt.setEnabled(!Rozdavani.bezi());
                akt.setText(getString(Rozdavani.bezi() ? R.string.aktualizuji : R.string.aktualizovat_ted));
                handler.postDelayed(this, 2000);
            }
        }, 2000);

        if (verze == null) {
            TextView kroky = new TextView(this);
            kroky.setText(getString(R.string.kroky_nastaveni_prime));
            obsah.addView(kroky);
        }
        obsah.addView(tlacitko(getString(R.string.wifi), () -> startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS))));
        obsah.addView(tlacitko(getString(R.string.nastaveni), () -> startActivity(new Intent(Settings.ACTION_SETTINGS))));
        Button kiosk = tlacitko(getString(R.string.spustit_kiosk), () -> {
            nastaveni.nastavServis(false);
            ukaz(Politika.zamkni(this));
            zamkni();
            spustKiosk();
        });
        kiosk.setEnabled(verze != null && nastaveni.maPlatnyPin());
        obsah.addView(kiosk);
        obsah.addView(tlacitko(getString(R.string.uvolnit), this::potvrdUvolneni));
    }

    private void odpocet(int zbyva) {
        // Nápověda nese TUKNUTI, ne opsané číslo — jinak by se text rozešel s tím,
        // co tuknutiNaNadpis() opravdu počítá.
        stav.setText(getString(R.string.spoustim_za, BuildConfig.KIOSK_PACKAGE, zbyva)
            + "\n\n" + getString(R.string.servis_napoveda, TUKNUTI));
        if (zbyva <= 0) {
            spustKiosk();
            return;
        }
        handler.postDelayed(() -> odpocet(zbyva - 1), 1000);
    }

    private void spustKiosk() {
        if (!Kiosk.spust(this)) vykresli();
    }

    private void zamkni() {
        ActivityManager am = getSystemService(ActivityManager.class);
        if (am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) return;
        if (!Politika.dpm(this).isLockTaskPermitted(getPackageName())) return;
        startLockTask();
    }

    private void ukonciZamek() {
        ActivityManager am = getSystemService(ActivityManager.class);
        if (am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) return;
        try {
            stopLockTask();
        } catch (IllegalStateException | SecurityException e) {
            // Zámek nezačala tahle aktivita; zpráva to ukáže, servis pokračuje.
            zprava.setText(getString(R.string.zamek_nejde_ukoncit, e.getMessage()));
        }
    }

    private void tuknutiNaNadpis() {
        long ted = System.currentTimeMillis();
        if (ted - prvniTuknuti > TUKNUTI_OKNO_MS) {
            prvniTuknuti = ted;
            tuknuti = 0;
        }
        if (++tuknuti < TUKNUTI || nastaveni.servis()) return;
        tuknuti = 0;
        // Bez platného PINu kiosk nikdy nezamkl tovární reset; cesta ven je tedy volná.
        if (!nastaveni.maPlatnyPin()) {
            vstupDoServisu();
            return;
        }
        long zbyva = nastaveni.zamcenoDo() - ted;
        if (zbyva > 0) {
            zprava.setText(getString(R.string.pin_zamceno, (int) Math.ceil(zbyva / 60000.0)));
            return;
        }
        handler.removeCallbacksAndMessages(null);
        EditText pole = new EditText(this);
        pole.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        new AlertDialog.Builder(this)
            .setTitle(getString(R.string.pin_nadpis))
            .setView(pole)
            .setPositiveButton(android.R.string.ok, (d, w) -> overPin(pole.getText().toString()))
            .setNegativeButton(android.R.string.cancel, (d, w) -> vykresli())
            .setOnCancelListener(d -> vykresli())
            .show();
    }

    private void overPin(String pin) {
        if (Pin.zeZaznamu(nastaveni.pinZaznam()).over(pin)) {
            nastaveni.spravnyPin();
            vstupDoServisu();
        } else {
            nastaveni.chybnyPin(System.currentTimeMillis());
            zprava.setText(getString(R.string.pin_spatne));
            vykresli();
        }
    }

    private void vstupDoServisu() {
        nastaveni.nastavServis(true);
        ukaz(Politika.uvolniProServis(this));
        vykresli();
    }

    private void potvrdUvolneni() {
        new AlertDialog.Builder(this)
            .setMessage(getString(R.string.uvolnit_potvrzeni))
            .setPositiveButton(getString(R.string.uvolnit), (d, w) -> {
                ukaz(Politika.uvolniTablet(this));
                vykresli();
            })
            .setNegativeButton(android.R.string.cancel, null)
            .show();
    }

    private void ukaz(List<String> radky) {
        zprava.setText(String.join("\n", radky));
    }

    private Button tlacitko(String text, Runnable akce) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(v -> akce.run());
        return b;
    }
}
