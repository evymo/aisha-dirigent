package cz.platforma.rizenakonfigurace

import android.content.Context
import android.content.RestrictionsManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Řízená konfigurace (managed configuration), kterou zařízení dostalo od svého
 * správce — u nás od hlídače, který je device owner.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): appka z Obchodu Play sama o sobě NESMÍ vědět,
 * kam se připojit ani čím se ohlásit u dveří. Adresu a identitu u dveří dostane
 * až na zavedeném tabletu, od hlídače.
 *
 * ⛔ PROČ PRÁVĚ TENHLE KANÁL. `RestrictionsManager` je jediná cesta, kde ANDROID
 * SÁM ručí, že hodnoty pocházejí od správce zařízení. Soubor ve sdíleném
 * úložišti ani broadcast tu záruku nemají — appka by nepoznala, kdo jí
 * konfiguraci podstrčil, a „nikdo nemůže klepat na dveře" by přestalo platit.
 *
 * ⛔ VRACÍ JEN ŘETĚZCE. Hodnoty jdou rovnou do rozhodování o dveřích, kde se
 * port stejně parsuje z textu; jeden tvar na hranici = jeden tvar k ověření.
 * Neřízené zařízení vrátí PRÁZDNO, ne výjimku: běžný telefon řidiče správce
 * nemá a to není porucha.
 */
class RizenaKonfiguraceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RizenaKonfigurace")

    Function("precti") {
      val ctx = appContext.reactContext ?: return@Function emptyMap<String, String>()
      val rm = ctx.getSystemService(Context.RESTRICTIONS_SERVICE) as? RestrictionsManager
        ?: return@Function emptyMap<String, String>()
      val b = rm.applicationRestrictions ?: return@Function emptyMap<String, String>()
      val out = HashMap<String, String>()
      for (klic in b.keySet()) {
        when (val h = b.get(klic)) {
          is String -> if (h.isNotEmpty()) out[klic] = h
          is Int -> out[klic] = h.toString()
          is Long -> out[klic] = h.toString()
          is Boolean -> out[klic] = h.toString()
          else -> {}
        }
      }
      out
    }
  }
}
