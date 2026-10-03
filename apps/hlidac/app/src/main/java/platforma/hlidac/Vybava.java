package platforma.hlidac;

import android.os.PersistableBundle;

/**
 * Výbava, kterou hlídač rozdává appkám na tabletu: KAM se připojit a ČÍM se
 * ohlásit u dveří.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „hlídač by měl nést potřebné informace, třeba
 * url, na které se řidičova appka připojuje… tím pádem by nám ani nemohl nikdo
 * klepat na dveře, protože by jen s appkou ve store nevěděl jak."
 *
 * ⛔ PROČ TO NENÍ V SESTAVENÍ APPKY. Dnes se adresa i `kid` PEČOU do APK
 * (`EXPO_PUBLIC_KNOCK_*`). To má tři důsledky a tenhle soubor ruší všechny tři:
 *   1. každá změna adresy si vynutí nový build,
 *   2. APK je přenositelné — kdo ho získá, má návod, KAM klepat,
 *   3. jedna binárka neumí sloužit dvěma instancím.
 * Výbava přichází ze zavedení tabletu (QR), tedy z dat instance. Appka bez
 * zavedeného hlídače neví ani adresu, natož čím se ohlásit.
 *
 * ⛔ VÝBAVA NENÍ TAJEMSTVÍ a nesmí se jím stát. Adresa, port, `kid` a `scope`
 * jsou KONFIGURACE: kdo je zná, ještě neumí zaťukat — klíč se odvozuje z kódu,
 * který zadá člověk, nebo si ho zařízení vyrobí samo a pošle jen veřejnou půlku
 * (`register_knock_device`). Kdyby hlídač rozdával i klíč, stačilo by ukrást
 * tablet a řetěz by byl horší než dnes.
 */
final class Vybava {
    /** Klíče v provisioning bundlu (QR). Jména jsou součástí kontraktu se `qr.mjs`. */
    static final String KLIC_API_URL = "platforma.hlidac.API_URL";
    static final String KLIC_KNOCK_HOST = "platforma.hlidac.KNOCK_HOST";
    static final String KLIC_KNOCK_PORT = "platforma.hlidac.KNOCK_PORT";
    static final String KLIC_KNOCK_KID = "platforma.hlidac.KNOCK_KID";
    static final String KLIC_KNOCK_SCOPE = "platforma.hlidac.KNOCK_SCOPE";

    final String apiUrl;
    final String knockHost;
    final int knockPort;
    final String knockKid;
    final String knockScope;

    private Vybava(String apiUrl, String knockHost, int knockPort, String knockKid, String knockScope) {
        this.apiUrl = apiUrl;
        this.knockHost = knockHost;
        this.knockPort = knockPort;
        this.knockKid = knockKid;
        this.knockScope = knockScope;
    }

    /**
     * Výbava ze zavedení, nebo null. NIC SE NEDOSAZUJE: chybějící adresa je
     * chybějící vstup, ne důvod dosadit „rozumnou" hodnotu. Dosazený default by
     * poslal tablet klepat na cizí instanci a poznalo by se to až mlčením dveří.
     */
    static Vybava zBundlu(PersistableBundle extra) {
        if (extra == null) return null;
        String api = necoNeboNull(extra.getString(KLIC_API_URL));
        String host = necoNeboNull(extra.getString(KLIC_KNOCK_HOST));
        String kid = necoNeboNull(extra.getString(KLIC_KNOCK_KID));
        String scope = necoNeboNull(extra.getString(KLIC_KNOCK_SCOPE));
        // ⛔ PORT PŘICHÁZÍ OBĚMA TVARY. Z QR ho ManagedProvisioning uloží jako
        //    int, když ho `qr.mjs` vydá jako číslo, a jako String, když jako text.
        //    Kdyby se četl jen jeden tvar, druhý by dal null → sada dveří by
        //    vyšla jako ČÁSTEČNÁ → celá výbava null → appka by neznala ani API.
        String portText = necoNeboNull(extra.getString(KLIC_KNOCK_PORT));
        if (portText == null) {
            int cislem = extra.getInt(KLIC_KNOCK_PORT, 0);
            if (cislem != 0) portText = String.valueOf(cislem);
        }
        if (api == null) return null;
        int port = 0;
        if (portText != null) {
            try {
                port = Integer.parseInt(portText);
            } catch (NumberFormatException e) {
                return null;
            }
            if (port < 1 || port > 65535) return null;
        }
        // ⛔ ČÁSTEČNÁ SADA DVEŘÍ JE VŽDY VADA — appka by nabídku klepání skryla a
        //    nikdo by se nedozvěděl proč. Buď jsou všechny čtyři, nebo žádná.
        boolean neco = host != null || port != 0 || kid != null || scope != null;
        boolean vse = host != null && port != 0 && kid != null && scope != null;
        if (neco && !vse) return null;
        return new Vybava(api, host, port, kid, scope);
    }

    /** Uloží výbavu, ať přežije restart tabletu. */
    void uloz(Nastaveni n) {
        n.ulozVybavu("api_url", apiUrl);
        n.ulozVybavu("knock_host", knockHost);
        n.ulozVybavu("knock_port", knockPort == 0 ? null : String.valueOf(knockPort));
        n.ulozVybavu("knock_kid", knockKid);
        n.ulozVybavu("knock_scope", knockScope);
    }

    /**
     * Uložená výbava, nebo null. Čte se TÝMŽ rozhodováním jako z QR (včetně
     * pravidla o částečné sadě dveří) — jinak by zapsaná a načtená výbava mohly
     * znamenat něco jiného a poznalo by se to až mlčením dveří.
     */
    static Vybava zNastaveni(Nastaveni n) {
        PersistableBundle b = new PersistableBundle();
        polozka(b, KLIC_API_URL, n.vybava("api_url"));
        polozka(b, KLIC_KNOCK_HOST, n.vybava("knock_host"));
        polozka(b, KLIC_KNOCK_PORT, n.vybava("knock_port"));
        polozka(b, KLIC_KNOCK_KID, n.vybava("knock_kid"));
        polozka(b, KLIC_KNOCK_SCOPE, n.vybava("knock_scope"));
        return zBundlu(b);
    }

    private static void polozka(PersistableBundle b, String klic, String hodnota) {
        if (hodnota != null) b.putString(klic, hodnota);
    }

    /** Má tahle výbava i dveře, nebo jen adresu API? */
    boolean maDvere() {
        return knockHost != null && knockPort != 0 && knockKid != null && knockScope != null;
    }

    private static String necoNeboNull(String s) {
        if (s == null) return null;
        String o = s.trim();
        return o.isEmpty() ? null : o;
    }
}
