package platforma.hlidac;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Co si hlídač pamatuje. Úložiště chráněné zařízením (direct boot), aby
 * hlídač věděl, jestli je v servisu, i před prvním odemčením po startu.
 */
final class Nastaveni {
    private static final String SOUBOR = "hlidac";
    private static final String PIN = "pin";
    private static final String OKNO = "okno";
    private static final String OKNO_ODMITNUTO = "okno_odmitnuto";
    private static final String SERVIS = "servis";
    private static final String CHYBNE = "chybne";
    private static final String ZAMCENO_DO = "zamceno_do";
    private static final String V_OKNE = "v_okne";
    private static final String VYBAVA = "vybava_";
    private static final String ROZDAVANI = "rozdavani";
    private static final String NABIDKA = "nabidka";
    private static final String BALICKY = "nabizene_balicky";
    private static final String ID_ZARIZENI = "id_zarizeni";

    /** Po kolika chybných PINech se zadávání na chvíli zastaví, a na jak dlouho. */
    static final int MAX_CHYBNYCH = 5;
    static final long ZAMKNUTI_MS = 5 * 60 * 1000L;

    private final SharedPreferences p;

    Nastaveni(Context ctx) {
        p = ctx.createDeviceProtectedStorageContext().getSharedPreferences(SOUBOR, Context.MODE_PRIVATE);
    }

    /** Záznam PINu, nebo null — bez PINu hlídač kiosk nezamkne (nebylo by jak ven). */
    String pinZaznam() {
        return p.getString(PIN, null);
    }

    void ulozPin(String zaznam) {
        p.edit().putString(PIN, zaznam).apply();
    }

    boolean maPlatnyPin() {
        try {
            Pin.zeZaznamu(pinZaznam());
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    NocniOkno okno() {
        try {
            return NocniOkno.parse(p.getString(OKNO, NocniOkno.VYCHOZI));
        } catch (RuntimeException e) {
            // Vadný zápis okna nesmí shodit hlídače; vezme se výchozí a servisní
            // panel ho ukáže, takže je vidět, co platí.
            return NocniOkno.parse(NocniOkno.VYCHOZI);
        }
    }

    void ulozOkno(String zapis) {
        NocniOkno.parse(zapis); // vadný zápis se nepřijme
        p.edit().putString(OKNO, zapis).remove(OKNO_ODMITNUTO).apply();
    }

    /**
     * Okno z QR, které se nepřijalo. ⛔ NAMĚŘENO 2026-09-28: „…-24:00" se jen
     * zalogovalo a platilo TIŠE výchozí okno. Teď ho servis ukáže jako ✗.
     */
    void ulozOdmitnuteOkno(String zapis) {
        p.edit().putString(OKNO_ODMITNUTO, zapis).apply();
    }

    String odmitnuteOkno() {
        return p.getString(OKNO_ODMITNUTO, null);
    }

    /** Servisní režim: kiosk vypnutý, omezení zvednutá. Po nastavení tabletu je zapnutý. */
    boolean servis() {
        return p.getBoolean(SERVIS, true);
    }

    void nastavServis(boolean zapnuto) {
        p.edit().putBoolean(SERVIS, zapnuto).apply();
    }

    boolean vOkne() {
        return p.getBoolean(V_OKNE, false);
    }

    void nastavVOkne(boolean ano) {
        p.edit().putBoolean(V_OKNE, ano).apply();
    }

    /**
     * Výbava (kam se připojit) přežívá restart: appka ji po každém startu čte
     * z řízené konfigurace, kterou hlídač musí umět obnovit i bez nového QR.
     */
    String vybava(String klic) {
        return p.getString(VYBAVA + klic, null);
    }

    void ulozVybavu(String klic, String hodnota) {
        if (hodnota == null) p.edit().remove(VYBAVA + klic).apply();
        else p.edit().putString(VYBAVA + klic, hodnota).apply();
    }

    /**
     * Poslední krok rozdávání appek — co technik uvidí v servisním panelu.
     *
     * ⛔ PROČ TO TU JE (2026-09-22): hlídač hlásil výsledky JEN do logu, a log je
     *    na tabletu zamčený (hlídač sám zakazuje ladění). První tablet se zavedl,
     *    Řidič nedorazil — a nikdo, ani technik u tabletu, nevěděl proč.
     */
    String stavRozdavani() {
        return p.getString(ROZDAVANI, null);
    }

    /** Co platforma naposledy nabídla (balíček, verze) — pro diagnostiku v servisu. */
    String nabidka() {
        return p.getString(NABIDKA, null);
    }

    void ulozNabidku(String text) {
        p.edit().putString(NABIDKA, text).apply();
    }

    /** Jména balíčků z poslední nabídky — hlášení o nich řekne, co je nainstalované. */
    java.util.List<String> nabizeneBalicky() {
        String s = p.getString(BALICKY, "");
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String b : s.split(",")) if (!b.isEmpty()) out.add(b);
        return out;
    }

    void ulozNabizeneBalicky(java.util.List<String> balicky) {
        p.edit().putString(BALICKY, String.join(",", balicky)).apply();
    }

    /**
     * Náhodné id TÉTO instalace Kiosk Admina — klíč, pod kterým administrace vede
     * hlášení tabletu. Není to průkaz ani tajemství: nic neotevírá, jen odliší
     * jeden tablet od druhého. Tovární reset = nové id (a nový řádek v přehledu).
     */
    synchronized String idZarizeni() {
        String id = p.getString(ID_ZARIZENI, null);
        if (id == null) {
            id = java.util.UUID.randomUUID().toString();
            p.edit().putString(ID_ZARIZENI, id).commit();
        }
        return id;
    }

    void ulozStavRozdavani(String text) {
        String cas = new java.text.SimpleDateFormat("d.M. HH:mm:ss", java.util.Locale.ROOT).format(new java.util.Date());
        p.edit().putString(ROZDAVANI, cas + " · " + text).apply();
    }

    long zamcenoDo() {
        return p.getLong(ZAMCENO_DO, 0L);
    }

    /** Zapíše chybný pokus; po MAX_CHYBNYCH zamkne zadávání. */
    void chybnyPin(long ted) {
        int n = p.getInt(CHYBNE, 0) + 1;
        SharedPreferences.Editor e = p.edit().putInt(CHYBNE, n);
        if (n >= MAX_CHYBNYCH) e.putInt(CHYBNE, 0).putLong(ZAMCENO_DO, ted + ZAMKNUTI_MS);
        e.apply();
    }

    void spravnyPin() {
        p.edit().putInt(CHYBNE, 0).putLong(ZAMCENO_DO, 0L).apply();
    }
}
