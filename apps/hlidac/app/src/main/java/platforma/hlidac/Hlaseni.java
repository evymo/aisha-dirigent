package platforma.hlidac;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.Build;
import android.util.Log;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Hlášení tabletu platformě: co je na něm nainstalované a jak dopadlo poslední
 * rozdávání. Z hlášení skládá administrace přehled zařízení.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-28): „chceme v administraci přehled instalovaných
 * zařízení i s informací o stavu instalace." Do té doby byl stav vidět jen
 * v servisním režimu u tabletu.
 *
 * ⛔ HLÁŠENÍ JE INFORMACE, NE IDENTITA. Posílá se bez přihlášení (za dveřmi,
 *    jako seznam appek) pod náhodným id instalace. Nic osobního a žádné
 *    tajemství: model, Android, verze balíčků, režim, poslední stav. Server
 *    tělo s čímkoli navíc odmítne celé.
 *
 * ⛔ SELHÁNÍ HLÁŠENÍ NIC NEZASTAVÍ. Tablet bez přehledu je pořád funkční tablet;
 *    hlášení se zkusí znovu při dalším rozdávání, instalaci nebo startu.
 */
final class Hlaseni {
    private static final String TAG = "hlidac.hlaseni";
    static final String CESTA_HLASENI = "/storage/v1/zarizeni/hlaseni";
    private static final int TIMEOUT_MS = 20_000;
    /** Po 429 (tablety za jednou adresou operátora) jednou počkat a zkusit znovu. */
    static final long CEKANI_PO_429_MS = 30_000;
    /** Stejné stropy jako na serveru (services/storage-auth/src/lib/hlaseni.ts). */
    static final int MAX_STAV = 300;
    static final int MAX_MODEL = 80;
    static final int MAX_ANDROID = 20;
    static final int MAX_WEBVIEW = 120;

    private Hlaseni() {}

    /** Odešle hlášení. ⛔ NESMÍ BĚŽET NA HLAVNÍM VLÁKNĚ — mluví s API. */
    static void odesli(Context ctx) {
        Nastaveni n = new Nastaveni(ctx);
        Vybava v = Vybava.zNastaveni(n);
        if (v == null) return; // bez adresy platformy není kam hlásit
        Map<String, Long> appky = new LinkedHashMap<>();
        appky.put(BuildConfig.KIOSK_PACKAGE, Rozdavani.nainstalovanaVerze(ctx, BuildConfig.KIOSK_PACKAGE));
        for (String b : n.nabizeneBalicky()) {
            if (!b.equals(ctx.getPackageName()) && !appky.containsKey(b)) appky.put(b, Rozdavani.nainstalovanaVerze(ctx, b));
        }
        String telo = telo(
                n.idZarizeni(),
                Build.MANUFACTURER + " " + Build.MODEL,
                Build.VERSION.RELEASE + " (" + Build.VERSION.SDK_INT + ")",
                BuildConfig.VERSION_NAME,
                BuildConfig.VERSION_CODE,
                appky,
                Politika.webView(),
                n.servis() ? "servis" : "kiosk",
                n.stavRozdavani());
        for (int pokus = 0; pokus < 2; pokus++) {
            try {
                int kod = posli(v.apiUrl + CESTA_HLASENI, telo);
                if (kod == 204 || kod == 200) return;
                if (kod == 429 && pokus == 0) {
                    Thread.sleep(CEKANI_PO_429_MS);
                    continue;
                }
                Log.w(TAG, "hlášení odmítnuto: HTTP " + kod);
                return;
            } catch (IOException e) {
                Log.w(TAG, "hlášení se nepodařilo odeslat: " + e.getMessage());
                return;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** Z přijímače vysílání: hlášení mimo hlavní vlákno, přijímač drží do konce. */
    static void odesliNaPozadi(BroadcastReceiver prijimac, Context ctx) {
        BroadcastReceiver.PendingResult r = prijimac.goAsync();
        Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                odesli(app);
            } finally {
                r.finish();
            }
        }, "hlidac-hlaseni").start();
    }

    private static int posli(String url, String telo) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            byte[] data = telo.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(data.length);
            try (OutputStream out = c.getOutputStream()) {
                out.write(data);
            }
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    /**
     * Tělo hlášení. Skládá se ručně (bez org.json), aby šlo změřit v jednotkovém
     * testu; texty se zkrátí na stropy serveru a řídicí znaky nahradí mezerou —
     * server by jinak celé hlášení odmítl.
     */
    static String telo(String id, String model, String android, String kaNazev, long kaKod,
                       Map<String, Long> appky, String webView, String rezim, String stav) {
        StringBuilder s = new StringBuilder(512);
        s.append("{\"zarizeni\":").append(text(id, 36))
         .append(",\"model\":").append(text(model, MAX_MODEL))
         .append(",\"android\":").append(text(android, MAX_ANDROID))
         .append(",\"kioskAdmin\":{\"versionName\":").append(text(kaNazev, 40))
         .append(",\"versionCode\":").append(kaKod).append('}')
         .append(",\"appky\":[");
        boolean prvni = true;
        for (Map.Entry<String, Long> a : appky.entrySet()) {
            if (!prvni) s.append(',');
            prvni = false;
            s.append("{\"balicek\":").append(text(a.getKey(), 100))
             .append(",\"versionCode\":").append(Math.max(-1L, a.getValue())).append('}');
        }
        s.append("],\"webview\":").append(webView == null ? "null" : text(webView, MAX_WEBVIEW))
         .append(",\"rezim\":").append(text(rezim, 10))
         .append(",\"stav\":").append(text(stav == null ? "" : stav, MAX_STAV))
         .append('}');
        return s.toString();
    }

    /** JSON řetězec: zkrácený, bez řídicích znaků, s escapovanými uvozovkami a lomítky. */
    static String text(String v, int max) {
        String t = v == null ? "" : v;
        if (t.length() > max) t = t.substring(0, max);
        StringBuilder s = new StringBuilder(t.length() + 2).append('"');
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (c == '"' || c == '\\') s.append('\\').append(c);
            else if (c < 0x20 || c == 0x7f) s.append(' ');
            else s.append(c);
        }
        return s.append('"').toString();
    }
}
