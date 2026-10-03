// Hlídač — device owner, který drží tablet v kiosku s aplikací instance.
//
// ⭐ KÓD JE OBECNÝ, IDENTITA PATŘÍ INSTANCI. Jméno balíčku, verze, popisek,
// cílová aplikace kiosku a otisk podpisu se čtou ze souboru instance
// (`HLIDAC_INSTANCE`), stejně jako mobile-app bere identitu z version.json
// povrchu. Chybějící nebo vadný soubor build ZASTAVÍ: hlídač s vymyšlenou
// identitou by se na tabletu nedal aktualizovat ani uvolnit.
import groovy.json.JsonSlurper

plugins { id("com.android.application") }

val instancniSoubor: File = System.getenv("HLIDAC_INSTANCE")?.let { file(it) }
    ?: throw GradleException(
        "HLIDAC_INSTANCE není nastavené — cesta k hlidac.json instance (vzor: apps/hlidac/hlidac.example.json).")
if (!instancniSoubor.isFile) throw GradleException("HLIDAC_INSTANCE neukazuje na soubor: $instancniSoubor")

@Suppress("UNCHECKED_CAST")
val instance = JsonSlurper().parse(instancniSoubor) as Map<String, Any?>
@Suppress("UNCHECKED_CAST")
val kiosk = instance["kiosk"] as? Map<String, Any?> ?: throw GradleException("hlidac.json: chybí `kiosk`")

val balicek = Regex("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$")
fun povinnyText(mapa: Map<String, Any?>, klic: String): String =
    (mapa[klic] as? String)?.takeIf { it.isNotBlank() } ?: throw GradleException("hlidac.json: chybí `$klic`")

val applicationIdInstance = povinnyText(instance, "applicationId")
val kioskBalicek = povinnyText(kiosk, "package")
for (b in listOf(applicationIdInstance, kioskBalicek)) {
    if (!balicek.matches(b)) throw GradleException("hlidac.json: `$b` není platné jméno balíčku")
}
if (applicationIdInstance == kioskBalicek) throw GradleException("hlidac.json: hlídač a kiosková aplikace nesmí mít týž balíček")
val kodVerze = (instance["versionCode"] as? Number)?.toInt()?.takeIf { it > 0 }
    ?: throw GradleException("hlidac.json: `versionCode` musí být kladné celé číslo")
@Suppress("UNCHECKED_CAST")
val opravneni = (kiosk["grantPermissions"] as? List<String>).orEmpty()
if (opravneni.any { !it.startsWith("android.permission.") }) {
    throw GradleException("hlidac.json: `kiosk.grantPermissions` smí obsahovat jen android.permission.*")
}

android {
    // Jmenný prostor tříd je obecný a neměnný; identita na tabletu je applicationId.
    namespace = "platforma.hlidac"
    compileSdk = 36
    defaultConfig {
        applicationId = applicationIdInstance
        minSdk = 30
        targetSdk = 36
        versionCode = kodVerze
        versionName = povinnyText(instance, "versionName")
        manifestPlaceholders["kioskPackage"] = kioskBalicek
        resValue("string", "app_name", povinnyText(instance, "label"))
        buildConfigField("String", "KIOSK_PACKAGE", "\"$kioskBalicek\"")
        buildConfigField("String[]", "KIOSK_PERMISSIONS",
            opravneni.joinToString(prefix = "new String[] {", postfix = "}") { "\"$it\"" })
    }
    buildFeatures { buildConfig = true }

    // Podpis jen z prostředí (klíč leží v trezoru, nikdy v repu). Bez klíče
    // se release nepostaví — ladicí podpis by na tabletu nešel aktualizovat.
    signingConfigs {
        create("release") {
            val cesta = System.getenv("HLIDAC_KEYSTORE_PATH")
            if (cesta != null) {
                storeFile = file(cesta)
                storePassword = System.getenv("HLIDAC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("HLIDAC_KEY_ALIAS")
                keyPassword = System.getenv("HLIDAC_KEY_PASSWORD") ?: System.getenv("HLIDAC_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("HLIDAC_KEYSTORE_PATH") != null) signingConfigs.getByName("release") else null
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
