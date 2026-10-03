package platforma.hlidac;

import android.content.Context;
import android.content.pm.PackageInstaller;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Instalace balíčku mimo Obchod Play.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „nešlo by aplikaci aktualizovat i mimo
 * playstore, když už tam máme hlídače?"
 *
 * Hlídač JE device owner, takže `PackageInstaller` doručí balíček bez
 * součinnosti řidiče a tablet zůstane v kiosku. Tichá instalace z device ownera
 * je nejsilnější schopnost na tabletu — proto se otisk ověřuje PŘED instalací a
 * nesouhlasí-li, balíček se ZAHODÍ. Tichá instalace „aspoň něčeho" je horší než
 * neaktualizovaná appka: ta se pozná, tamto ne.
 *
 * ── ⛔ STAHUJE SE PO ČÁSTECH, A TO NENÍ OPTIMALIZACE ─────────────────────────
 * NAMĚŘENO 2026-09-22 na živé instanci:
 *   · cesta ven má strop ~60 s na délku požadavku (120 kB rozložených do 90 s
 *     spadlo stejně jako 60 MB — tedy limit je ČAS, ne objem),
 *   · APK řidiče (52 MB) se stahovalo rychlostí 50 kB/s: za 300 s dorazilo 15 MB.
 * Jedním požadavkem to tablet NESTÁHNE NIKDY. Každý kus proto musí doběhnout
 * hluboko pod stropem, a když se přenos utrhne, musí jít NAVÁZAT — po LTE se
 * trhá běžně a bez navazování by se začínalo od nuly pořád dokola.
 *
 * ⛔ DO SOUBORU, NE DO PAMĚTI. Dřív se celé APK načítalo do `byte[]`; u 52 MB je
 * to na tabletu riziko samo o sobě a u větší appky jistý pád.
 *
 * ⛔ SERVER MUSÍ NAVAZOVÁNÍ UMĚT. Bez `Accept-Ranges` se zpátky ke stahování
 * vcelku NEPŘEPÍNÁ: to je přesně ten požadavek, který na strop narazí. Chybějící
 * podpora je vada serveru a hlásí se jako taková.
 */
final class Aktualizace {
    private static final String TAG = "hlidac.aktualizace";
    /** Strop na JEDEN kus. Server má ~60 s; 25 s dává rezervu i při výpadku signálu. */
    private static final int TIMEOUT_MS = 25_000;
    /**
     * Počáteční velikost kusu. Při naměřených 50 kB/s trvá 1 MB ~20 s — tedy
     * pohodlně pod stropem. Další kusy se řídí naměřenou rychlostí (`dalsiKus`).
     */
    static final int KUS = 1024 * 1024;
    /** Nejmenší kus — když ani 1 MB nedoběhne v rozumném čase (slabý signál). */
    static final int KUS_MIN = 256 * 1024;
    /** Největší kus. Na LTE (~2 MB/s) je to pár sekund; strop cesty je ~60 s. */
    static final int KUS_MAX = 8 * 1024 * 1024;
    /** Kus, který doběhl pod touto dobou, se příště zdvojnásobí. */
    static final long RYCHLY_KUS_MS = 5_000;
    /** Kus, který trval déle, se příště zmenší na polovinu — daleko od stropu ~60 s. */
    static final long POMALY_KUS_MS = 20_000;
    /** Kolikrát zkusit TÝŽ kus, než se stahování vzdá. */
    private static final int POKUSU = 3;
    /**
     * Kolikrát za jedno stahování počkat na přetížený server (429/503). Čekání
     * se nepočítá do POKUSU — server nic nerozbil, jen říká „ne teď".
     */
    private static final int CEKANI_MAX = 20;
    /** Čekání bez `Retry-After`, a strop na něj (server by mohl poslat hodinu). */
    static final long CEKANI_VYCHOZI_MS = 30_000;
    static final long CEKANI_STROP_MS = 120_000;

    private Aktualizace() {}

    /** Výsledek — ať volající umí rozlišit „nebylo co" od „nepovedlo se". */
    enum Stav { NAINSTALOVANO, BEZ_ZMENY, OTISK_NESEDI, STAHOVANI_SELHALO, INSTALACE_SELHALA }

    /**
     * Co se během stahování a vložení děje — pro servisní panel. Log je na tabletu
     * zamčený, takže bez tohohle je každé selhání neviditelné.
     */
    interface Hlaseni {
        void prubeh(long stazeno, long celkem);

        void duvod(String text);
    }

    private static final Hlaseni NIC = new Hlaseni() {
        @Override public void prubeh(long stazeno, long celkem) {}
        @Override public void duvod(String text) {}
    };

    /**
     * Stáhne balíček z `url`, ověří jeho `sha256` a teprve pak nainstaluje.
     *
     * @param ocekavanySha256 hex otisk z deklarace instance; bez něj se NEINSTALUJE
     */
    static Stav nainstaluj(Context ctx, String url, String ocekavanySha256, Hlaseni hlaseni) {
        final Hlaseni h = hlaseni == null ? NIC : hlaseni;
        if (url == null || url.isEmpty() || ocekavanySha256 == null || ocekavanySha256.isEmpty()) {
            // Chybějící deklarace není „nic k aktualizaci" — je to chybějící vstup.
            Log.w(TAG, "bez url nebo otisku se neinstaluje");
            return Stav.BEZ_ZMENY;
        }
        // ⛔ Rozpracovaný soubor patří JEDNOMU otisku. Hlídač stahuje i sebe i Řidiče;
        //    společné jméno by dalo navázat zbytek jednoho balíčku na druhý.
        File soubor = new File(ctx.getCacheDir(), jmenoRozpracovaneho(ocekavanySha256));
        try {
            stahniPoCastech(url, soubor, h);
        } catch (IOException e) {
            // ⛔ ROZPRACOVANÉ SE NEMAŽE (2026-09-28). Dřív se po třech selháních
            //    v řadě zahodilo i to, co už leželo na disku — a příští pokus
            //    začal od nuly (na tabletech 2–5× celý Řidič za večer). Soubor
            //    patří jednomu otisku a před instalací se otisk ověří, takže
            //    navázat je bezpečné; nesedící celek se zahodí níž.
            h.duvod("stažení: " + e.getMessage());
            Log.w(TAG, "stažení selhalo, rozpracované zůstává pro příští pokus: " + e.getMessage());
            return Stav.STAHOVANI_SELHALO;
        }
        String skutecny = sha256(soubor);
        if (skutecny == null || !skutecny.equalsIgnoreCase(ocekavanySha256)) {
            // ⛔ Otisk se nevypisuje celý: v logu tabletu nemá co dělat.
            Log.e(TAG, "OTISK NESEDÍ — balíček zahozen, neinstaluje se");
            soubor.delete();
            return Stav.OTISK_NESEDI;
        }
        try {
            vloz(ctx, soubor);
            return Stav.NAINSTALOVANO;
        } catch (IOException | RuntimeException e) {
            h.duvod("vložení: " + e.getMessage());
            Log.e(TAG, "instalace selhala: " + e.getMessage());
            return Stav.INSTALACE_SELHALA;
        } finally {
            soubor.delete();
        }
    }

    /**
     * Stáhne po kusech s navazováním. Už stažená část se při opakování NEZAHAZUJE
     * — to je celý smysl: na pomalé lince je druhý pokus od nuly totéž co žádný.
     */
    private static void stahniPoCastech(String url, File cil, Hlaseni h) throws IOException {
        long mame = cil.exists() ? cil.length() : 0;
        long celkem = -1;
        int selhaniVRade = 0;
        int cekani = 0;
        int kus = KUS;
        int pozadavku = 0;
        while (celkem < 0 || mame < celkem) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setInstanceFollowRedirects(true);
            long do_ = mame + kus - 1;
            c.setRequestProperty("Range", "bytes=" + mame + "-" + do_);
            long start = System.nanoTime();
            pozadavku++;
            try {
                int kod = c.getResponseCode();
                if (kod == 429 || kod == HttpURLConnection.HTTP_UNAVAILABLE) {
                    // ⛔ PŘETÍŽENÍ NENÍ SELHÁNÍ (2026-09-28). Tablety na LTE sdílejí
                    //    adresu operátora; limit serveru pak dopadne na víc tabletů
                    //    naráz. Dřív to byla tři „selhání" a konec — teď se počká,
                    //    kolik server řekne, a naváže se od téhož bajtu.
                    if (++cekani > CEKANI_MAX) throw new IOException("server je přetížený (HTTP " + kod + ")");
                    long ms = cekaniMs(c.getHeaderField("Retry-After"));
                    h.duvod("server je přetížený (HTTP " + kod + "), čekám " + (ms / 1000) + " s");
                    spi(ms);
                    continue;
                }
                if (kod == 416) {
                    // Požadavek začíná za koncem souboru: na disku už leží celý
                    // (proces skončil dřív, než se ověřil otisk). Otisk rozhodne.
                    celkem = celkemZHlavicky(c.getHeaderField("Content-Range"));
                    if (mame < celkem) throw new IOException("HTTP 416 uprostřed souboru (" + mame + "/" + celkem + ")");
                    break;
                }
                if (kod == HttpURLConnection.HTTP_OK && mame == 0) {
                    // Server navazování neumí. Celý soubor jedním požadavkem je
                    // právě to, co na strop naráží — hlásíme vadu serveru.
                    throw new IOException("server neumí Range (odpověděl 200 na částečný požadavek)");
                }
                if (kod != 206) throw new IOException("HTTP " + kod);
                celkem = celkemZHlavicky(c.getHeaderField("Content-Range"));
                try (InputStream in = c.getInputStream();
                     OutputStream out = new FileOutputStream(cil, true)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        mame += n;
                    }
                }
                selhaniVRade = 0;
                kus = dalsiKus(kus, (System.nanoTime() - start) / 1_000_000L);
                h.prubeh(mame, celkem);
            } catch (IOException e) {
                mame = cil.exists() ? cil.length() : 0; // kolik doopravdy leží na disku
                kus = Math.max(KUS_MIN, kus / 2);
                if (++selhaniVRade >= POKUSU) throw e;
                Log.w(TAG, "kus selhal (" + e.getMessage() + "), navazuji od " + mame);
            } finally {
                c.disconnect();
            }
        }
        Log.i(TAG, "staženo " + mame + " B, " + pozadavku + " požadavků");
    }

    /**
     * Velikost dalšího kusu podle toho, jak dlouho trval ten poslední.
     *
     * ⭐ LTE (2026-09-28): tablety pojedou po LTE. Pevný 1 MB kus je tam ~0,5 s
     * a 52 MB Řidič = 50 požadavků; po zdvojování je to ~10. Na slabém signálu
     * se kus zmenší, takže strop cesty (~60 s) zůstává daleko.
     */
    static int dalsiKus(int kus, long trvaniMs) {
        if (trvaniMs < RYCHLY_KUS_MS) return Math.min(KUS_MAX, kus * 2);
        if (trvaniMs > POMALY_KUS_MS) return Math.max(KUS_MIN, kus / 2);
        return kus;
    }

    /** `Retry-After` v sekundách → ms; chybějící nebo nečitelný = výchozí, vždy pod stropem. */
    static long cekaniMs(String retryAfter) {
        if (retryAfter == null) return CEKANI_VYCHOZI_MS;
        try {
            long s = Long.parseLong(retryAfter.trim());
            return Math.max(1_000L, Math.min(CEKANI_STROP_MS, s * 1000L));
        } catch (NumberFormatException e) {
            // Tvar data (RFC 9110) se nepočítá — hodiny tabletu nemusí sedět.
            return CEKANI_VYCHOZI_MS;
        }
    }

    private static void spi(long ms) throws IOException {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("čekání přerušeno");
        }
    }

    /**
     * Zahodí rozpracované soubory, které už k žádné nabízené verzi nepatří.
     * Rozpracované se po selhání NEMAŽE (navazuje se), takže bez úklidu by se
     * v cache hromadily zbytky verzí, které platforma mezitím nahradila.
     */
    static void uklidRozpracovane(Context ctx, java.util.Set<String> nabizeneOtisky) {
        File[] soubory = ctx.getCacheDir().listFiles();
        if (soubory == null) return;
        java.util.Set<String> platne = new java.util.HashSet<>();
        for (String o : nabizeneOtisky) platne.add(jmenoRozpracovaneho(o));
        for (File f : soubory) {
            String jmeno = f.getName();
            if (jeRozpracovany(jmeno) && !platne.contains(jmeno) && f.delete()) {
                Log.i(TAG, "zahozen zbytek nenabízené verze");
            }
        }
    }

    static boolean jeRozpracovany(String jmenoSouboru) {
        return jmenoSouboru.startsWith("aktualizace-") && jmenoSouboru.endsWith(".apk");
    }

    /**
     * Jméno rozpracovaného souboru. Nese OTISK, ne obecné „aktualizace":
     * hlídač stahuje i sebe i Řidiče a navazuje podle délky souboru — společné
     * jméno by zbytek jednoho balíčku přilepilo k druhému.
     */
    static String jmenoRozpracovaneho(String ocekavanySha256) {
        return "aktualizace-" + ocekavanySha256.toLowerCase(java.util.Locale.ROOT) + ".apk";
    }

    /** `bytes 0-1048575/52114578` → 52114578. */
    static long celkemZHlavicky(String contentRange) throws IOException {
        if (contentRange == null) throw new IOException("odpověď 206 bez Content-Range");
        int l = contentRange.lastIndexOf('/');
        if (l < 0) throw new IOException("nečitelný Content-Range: " + contentRange);
        try {
            return Long.parseLong(contentRange.substring(l + 1).trim());
        } catch (NumberFormatException e) {
            throw new IOException("nečitelná velikost v Content-Range: " + contentRange);
        }
    }

    private static String sha256(File f) {
        try (InputStream in = new FileInputStream(f)) {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) d.update(buf, 0, n);
            StringBuilder s = new StringBuilder(64);
            for (byte b : d.digest()) s.append(String.format("%02x", b));
            return s.toString();
        } catch (IOException | NoSuchAlgorithmException e) {
            return null;
        }
    }

    private static void vloz(Context ctx, File balicek) throws IOException {
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        // Device owner: instalace je POLITIKA zařízení, ne volba uživatele.
        p.setInstallReason(android.content.pm.PackageManager.INSTALL_REASON_POLICY);
        long delka = balicek.length();
        p.setSize(delka);
        int id = pi.createSession(p);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            // ⛔ Proudem ze souboru, ne přes byte[]: 52 MB v paměti tabletu je
            //    riziko a u větší appky jistý pád.
            try (InputStream in = new FileInputStream(balicek);
                 OutputStream out = s.openWrite("balicek", 0, delka)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            // Výsledek instalace: PendingIntent je povinný, ale hlídač na něj
            // nečeká — instalace běží mimo kiosk a výsledek se objeví v logu.
            android.app.PendingIntent potvrzeni = android.app.PendingIntent.getBroadcast(
                    ctx, id,
                    new android.content.Intent(ctx, VysledekInstalace.class),
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_MUTABLE);
            s.commit(potvrzeni.getIntentSender());
        }
    }
}
