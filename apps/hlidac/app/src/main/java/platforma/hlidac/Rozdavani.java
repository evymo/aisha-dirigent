package platforma.hlidac;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Co hlídač rozdává tabletu: VÝBAVU (kam se připojit) a AKTUALIZACE (co má být
 * nainstalované) — obojí mimo Obchod Play.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „nešlo by aplikaci aktualizovat i mimo
 * playstore, když už tam máme hlídače? a hlídač by měl nést potřebné informace,
 * třeba url… tím pádem by nám ani nemohl nikdo klepat na dveře, protože by jen
 * s appkou ve store nevěděl jak."
 *
 * ⛔ VÝBAVA JDE ŘÍZENOU KONFIGURACÍ, NE SOUBOREM ANI INTENTEM. Device owner ji
 * předá přes `setApplicationRestrictions` a appka si ji přečte
 * `RestrictionsManager`em. Je to jediný kanál, kde ANDROID SÁM ručí, že hodnoty
 * pocházejí od správce zařízení: soubor ve sdíleném úložišti ani broadcast by
 * tuhle záruku neměly a appka by nepoznala, kdo jí konfiguraci podstrčil.
 *
 * ⛔ SEZNAM ŘÍKÁ, CO MÁ BÝT — NE, CO SE MÁ STÁHNOUT. Instaluje se jen balíček,
 * jehož `versionCode` je VYŠŠÍ než nainstalovaný. Bez toho porovnání by hlídač
 * při každém nočním okně stahoval a přeinstalovával totéž.
 */
final class Rozdavani {
    /**
     * Cesta k seznamu appek OD KOŘENE API (`vybava.apiUrl` je kořen — tak ho čte
     * i appka Řidiče). Storage visí v gatewayi pod `/storage/v1`.
     *
     * ⛔ NAMĚŘENO 2026-09-22: bez `/storage/v1` odpovídal server 404 a hlídač
     *    nenačetl ani SEZNAM — k tabletu nedorazila žádná appka, a zavedení
     *    přitom proběhlo „úspěšně". Hranici měří brána
     *    `cesta-hlidace-k-seznamu-appek-existuje`.
     */
    static final String CESTA_SEZNAMU_APPEK = "/storage/v1/zarizeni/appky";

    private static final String TAG = "hlidac.rozdavani";
    private static final int TIMEOUT_MS = 20_000;
    /** Jak dlouho počkat na dokončení odeslaných instalací, než se hlídač aktualizuje sám. */
    static final int CEKANI_NA_INSTALACE_POKUSU = 90;
    static final long CEKANI_NA_INSTALACE_KROK_MS = 2_000;

    /**
     * Jen JEDNO rozdávání naráz.
     *
     * ⛔ `Zavedeni.dokonci` volají DVĚ místa — `PolicyComplianceActivity` (Android
     *    12+) i `onProfileProvisioningComplete`, který Android posílá po zavedení
     *    taky. Dvě vlákna by pak stahovala 50 MB do TÉHOŽ rozpracovaného souboru,
     *    otisk by nesedl a obě by ho smazala. Stejně tak tlačítko v servisu
     *    zmáčknuté během nočního okna.
     */
    private static final AtomicBoolean BEZI = new AtomicBoolean(false);

    static boolean zaber() {
        return BEZI.compareAndSet(false, true);
    }

    static void uvolni() {
        BEZI.set(false);
    }

    static boolean bezi() {
        return BEZI.get();
    }

    /**
     * Pořadí zpracování: vlastní balíček (hlídač) VŽDY poslední. Jeho instalace
     * ukončí proces hlídače — co by přišlo po něm, by se nestihlo.
     */
    static java.util.List<Integer> poradi(java.util.List<String> balicky, String vlastni) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        java.util.List<Integer> nakonec = new java.util.ArrayList<>();
        for (int i = 0; i < balicky.size(); i++) {
            if (vlastni.equals(balicky.get(i))) nakonec.add(i);
            else out.add(i);
        }
        out.addAll(nakonec);
        return out;
    }

    private Rozdavani() {}

    /**
     * Předá výbavu kioskové appce. Bez výbavy se NIC NEMAŽE: prázdná řízená
     * konfigurace by appku odstřihla od API, ačkoli jen zrovna nepřišlo QR.
     */
    static void predejVybavu(Context ctx) {
        Vybava v = Vybava.zNastaveni(new Nastaveni(ctx));
        if (v == null) return;
        if (!Politika.jsemSpravce(ctx)) return;
        DevicePolicyManager dpm = Politika.dpm(ctx);
        Bundle b = new Bundle();
        b.putString(Vybava.KLIC_API_URL, v.apiUrl);
        if (v.maDvere()) {
            b.putString(Vybava.KLIC_KNOCK_HOST, v.knockHost);
            b.putInt(Vybava.KLIC_KNOCK_PORT, v.knockPort);
            b.putString(Vybava.KLIC_KNOCK_KID, v.knockKid);
            b.putString(Vybava.KLIC_KNOCK_SCOPE, v.knockScope);
        }
        try {
            dpm.setApplicationRestrictions(Politika.admin(ctx), BuildConfig.KIOSK_PACKAGE, b);
            Log.i(TAG, "výbava předána appce " + BuildConfig.KIOSK_PACKAGE + (v.maDvere() ? " (včetně dveří)" : " (bez dveří)"));
        } catch (RuntimeException e) {
            // Appka ještě nemusí být nainstalovaná — po instalaci se předá znovu.
            Log.w(TAG, "výbavu se nepodařilo předat: " + e.getMessage());
        }
    }

    /**
     * Projde seznam z platformy a doinstaluje, co je novější. Volá se z nočního
     * okna, tedy ve chvíli, kdy tablet stojí a nabíjí se.
     *
     * ⛔ NESMÍ BĚŽET NA HLAVNÍM VLÁKNĚ — stahuje z API.
     */
    static void zkusAktualizovat(Context ctx) {
        Nastaveni n = new Nastaveni(ctx);
        if (!zaber()) {
            Log.i(TAG, "rozdávání už běží — druhé se nespouští");
            return;
        }
        try {
            aktualizuj(ctx, n);
        } catch (RuntimeException e) {
            // Nečekaná vada nesmí zmizet v logu, který nikdo nevidí.
            n.ulozStavRozdavani(ctx.getString(R.string.roz_chyba, String.valueOf(e.getMessage())));
            Log.e(TAG, "rozdávání spadlo", e);
        } finally {
            uvolni();
        }
        // Přehled v administraci: jak rozdávání dopadlo (běží mimo hlavní vlákno).
        Hlaseni.odesli(ctx);
    }

    private static void aktualizuj(Context ctx, Nastaveni n) {
        Vybava v = Vybava.zNastaveni(n);
        if (v == null) {
            n.ulozStavRozdavani(ctx.getString(R.string.roz_bez_vybavy));
            Log.i(TAG, "bez výbavy se neaktualizuje — hlídač nezná adresu platformy");
            return;
        }
        n.ulozStavRozdavani(ctx.getString(R.string.roz_nacitam));
        JSONArray appky;
        try {
            appky = new JSONObject(stahniText(v.apiUrl + CESTA_SEZNAMU_APPEK)).optJSONArray("appky");
        } catch (IOException | RuntimeException | org.json.JSONException e) {
            n.ulozStavRozdavani(ctx.getString(R.string.roz_seznam_chyba, String.valueOf(e.getMessage())));
            Log.w(TAG, "seznam appek se nepodařilo načíst: " + e.getMessage());
            return;
        }
        if (appky == null || appky.length() == 0) {
            n.ulozStavRozdavani(ctx.getString(R.string.roz_zadna));
            return;
        }
        java.util.List<String> jmena = new java.util.ArrayList<>();
        StringBuilder nabidka = new StringBuilder();
        for (int i = 0; i < appky.length(); i++) {
            JSONObject a = appky.optJSONObject(i);
            String b = a == null ? "" : a.optString("balicek", "");
            jmena.add(b);
            if (a == null) continue;
            if (nabidka.length() > 0) nabidka.append(" · ");
            nabidka.append(b).append(' ').append(a.optString("versionName", "?"))
                .append(" (").append(a.optLong("versionCode", 0)).append(')');
        }
        n.ulozNabidku(nabidka.toString());
        java.util.Set<String> otisky = new java.util.HashSet<>();
        for (int i = 0; i < appky.length(); i++) {
            JSONObject a = appky.optJSONObject(i);
            if (a != null && !a.optString("sha256", "").isEmpty()) otisky.add(a.optString("sha256", ""));
        }
        Aktualizace.uklidRozpracovane(ctx, otisky);
        n.ulozNabizeneBalicky(jmena);
        boolean neco = false;
        java.util.Map<String, Long> odeslane = new java.util.LinkedHashMap<>();
        for (int i : poradi(jmena, ctx.getPackageName())) {
            JSONObject a = appky.optJSONObject(i);
            if (a == null) continue;
            String balicek = a.optString("balicek", "");
            String url = a.optString("url", "");
            String otisk = a.optString("sha256", "");
            long chtena = a.optLong("versionCode", 0);
            if (balicek.isEmpty() || url.isEmpty() || otisk.isEmpty() || chtena <= 0) {
                n.ulozStavRozdavani(ctx.getString(R.string.roz_neuplna));
                Log.w(TAG, "položka seznamu je neúplná, přeskakuji");
                continue;
            }
            long mame = nainstalovanaVerze(ctx, balicek);
            if (mame >= chtena) {
                n.ulozStavRozdavani(ctx.getString(R.string.roz_aktualni, balicek, mame));
                continue;
            }
            // ⛔ VLASTNÍ AKTUALIZACE AŽ PO DOKONČENÍ OSTATNÍCH (2026-09-28). Instalace
            //    je asynchronní: `NAINSTALOVANO` znamená jen ODESLÁNO. Hlídač pak hned
            //    instaloval sám sebe, Android ukončil jeho proces a Řidič se
            //    nenainstaloval — tablety ho za večer stahovaly 2–5× celý.
            if (balicek.equals(ctx.getPackageName()) && !odeslane.isEmpty()) {
                if (!pockej(() -> vseNainstalovano(ctx, odeslane), CEKANI_NA_INSTALACE_POKUSU,
                        CEKANI_NA_INSTALACE_KROK_MS, Rozdavani::spi)) {
                    String ceka = String.join(", ", odeslane.keySet());
                    n.ulozStavRozdavani(ctx.getString(R.string.roz_sebe_odlozeno, ceka));
                    Log.w(TAG, "vlastní aktualizace odložena — ještě se instaluje: " + ceka);
                    continue;
                }
            }
            final String jmeno = balicek;
            Aktualizace.Stav stav = Aktualizace.nainstaluj(ctx, url, otisk, new Aktualizace.Hlaseni() {
                @Override public void prubeh(long stazeno, long celkem) {
                    n.ulozStavRozdavani(ctx.getString(R.string.roz_stahuji, jmeno, stazeno >> 20, celkem >> 20));
                }
                @Override public void duvod(String text) {
                    n.ulozStavRozdavani(ctx.getString(R.string.roz_selhalo, jmeno, text));
                }
            });
            Log.i(TAG, balicek + ": " + mame + " → " + chtena + " = " + stav);
            if (stav == Aktualizace.Stav.OTISK_NESEDI) n.ulozStavRozdavani(ctx.getString(R.string.roz_otisk, balicek));
            // NAINSTALOVANO = balíček ODESLÁN; skutečný výsledek dorazí do VysledekInstalace.
            if (stav == Aktualizace.Stav.NAINSTALOVANO) {
                n.ulozStavRozdavani(ctx.getString(R.string.roz_odeslano, balicek));
                neco = true;
                odeslane.put(balicek, chtena);
            }
        }
        // ⛔ VÝBAVA SE PŘEDÁVÁ ZNOVU PO INSTALACI. Při zavedení tabletu appka
        //    ještě NEEXISTUJE, takže `setApplicationRestrictions` nemá komu
        //    hodnoty dát. Bez tohohle by tablet vypadal hotově, appka by běžela
        //    a NEZNALA ADRESU — a nikde by nestálo proč.
        if (neco) predejVybavu(ctx);
    }

    /** Jsou všechny odeslané balíčky nainstalované aspoň v chtěné verzi? */
    private static boolean vseNainstalovano(Context ctx, java.util.Map<String, Long> odeslane) {
        for (java.util.Map.Entry<String, Long> e : odeslane.entrySet()) {
            if (nainstalovanaVerze(ctx, e.getKey()) < e.getValue()) return false;
        }
        return true;
    }

    interface Spanek {
        void spi(long ms) throws InterruptedException;
    }

    /**
     * Ptá se `hotovo` nejvýš `pokusu`× s krokem `krokMs`. Přerušení = nehotovo
     * (vlastní aktualizace se odloží, nic se nerozbije).
     */
    static boolean pockej(java.util.function.BooleanSupplier hotovo, int pokusu, long krokMs, Spanek spanek) {
        for (int i = 0; i < pokusu; i++) {
            if (hotovo.getAsBoolean()) return true;
            try {
                spanek.spi(krokMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return hotovo.getAsBoolean();
    }

    private static void spi(long ms) throws InterruptedException {
        Thread.sleep(ms);
    }

    /** Verze nainstalovaného balíčku, nebo -1, když nainstalovaný není. */
    static long nainstalovanaVerze(Context ctx, String balicek) {
        try {
            android.content.pm.PackageInfo p = ctx.getPackageManager().getPackageInfo(balicek, 0);
            return android.os.Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return -1;
        }
    }

    private static String stahniText(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(TIMEOUT_MS);
        c.setReadTimeout(TIMEOUT_MS);
        try (InputStream in = c.getInputStream()) {
            if (c.getResponseCode() / 100 != 2) throw new IOException("HTTP " + c.getResponseCode());
            java.io.ByteArrayOutputStream ven = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) ven.write(buf, 0, n);
            return ven.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }
}
