/**
 * Autolinking: co se má na které platformě slinkovat.
 *
 * ⛔ PROČ TENHLE SOUBOR VZNIKL (naměřeno 2026-08-19)
 * -------------------------------------------------
 * Pravidlo majitele: „vždy jen a jen bez Rosetty a nativně pro arm, a ne jinak."
 * U iOS SIMULÁTORU to bylo nesplnitelné kvůli jediné závislosti:
 *
 *   MLKitVision.framework: x86_64 (simulátor) + arm64 (ZAŘÍZENÍ, platform 2)
 *
 * MLKit 8.0.0 dodává tučný `.framework`, ne `.xcframework`, a **arm64 řez pro
 * simulátor v něm není**. Proto jeho podspec nastavuje
 * `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` — není to zastaralý relikt,
 * je to konstatování faktu. Následek: simulátorový build vyšel jako x86_64
 * a moderní simulátor ho odmítl nainstalovat („Failed to find matching arch").
 * Tedy appka, kterou nešlo spustit ani nativně, ani přes Rosettu.
 *
 * ⭐ ŘEŠENÍ: vyřadit MLKit VÝHRADNĚ ze simulátorového buildu.
 *  · zařízení (iOS) — MLKit zůstává, OCR funguje;
 *  · Android — MLKit jde přes gradle a arm64 dodává, tady se NIC nemění;
 *  · iOS simulátor — pod se nelinkuje, build je nativní arm64.
 *
 * ⭐ KÓD TO UNESE BEZE ZMĚNY. `readMeterFromPhoto` (src/lib/meterOcr.ts) volá
 * modul dynamickým `import`em v `try/catch` a při jeho nepřítomnosti vrací
 * `null` — tedy „nepřečteno", což je stav, se kterým obrazovka odjakživa
 * počítá (člověk hodnotu zadá ručně, pole je editovatelné). Vypnuté OCR proto
 * není rozbitá appka, jen appka bez nápovědy.
 *
 * ⚠️ ZAPÍNÁ SE VÝSLOVNĚ, výchozí stav je „linkuj". Build pro obchod tak nemůže
 * omylem odejít bez OCR — musel by ho někdo vědomě vyřadit proměnnou.
 */
const preskocitMlKit = process.env.AISHA_SKIP_MLKIT === '1';
const preskocitHovory = process.env.AISHA_SKIP_LIVEKIT === '1';
const preskocitGrafy = process.env.AISHA_SKIP_SKIA === '1';

/**
 * ⭐ 2026-09-22: VYŘAZENÍ PLATÍ I PRO ANDROID a přibyly hovory a grafy.
 *
 * NAMĚŘENO na buildu `<fork>-ridic` (86 MB). Nativní knihovny se linkují podle
 * toho, co je NAINSTALOVANÉ, ne podle toho, co appka volá:
 *
 *   libjingle_peerconnection_so.so   11,5 MB   WebRTC pro LiveKit
 *   libmlkit_google_ocr_pipeline.so  10,6 MB   OCR v zařízení
 *   librnskia.so                      9,5 MB   Skia (peer `victory-native`)
 *
 * Dosažitelnost ověřena GRAFEM IMPORTŮ, ne hledáním v bundlu: ten je Hermes
 * bytecode a `grep` v něm nenajde ani řetězce, které tam nutně jsou — první
 * měření tím vyšlo úplně špatně.
 *   · `@livekit/react-native`  ← jen `useConsultationCall`, který NIKDO neimportuje.
 *     (`useStoryVoiceChannel` je dosažitelný, ale LiveKit NEIMPORTUJE — mluví
 *      jen s API o názvech místností.)
 *   · OCR ← `meterOcr`, a ten modul načítá DYNAMICKY v try/catch; bez něj vrací
 *     „nepřečteno" a člověk hodnotu zadá ručně. Appka se nerozbije.
 *   · Skia ← peer `victory-native`, a ten jen `src/app/health.tsx` (graf příznaků).
 *
 * ⛔ PROČ TO NENÍ JEN ÚSPORA MÍSTA. Balíček jde přes dveře a stahuje se do
 * KAŽDÉHO tabletu přes LTE při KAŽDÉ aktualizaci. Naměřeno 2026-09-22: cesta
 * dovnitř má strop ~60 s na délku požadavku (120 kB rozložených do 90 s spadlo
 * stejně jako 60 MB), a při 0,5 MB/s se 86 MB nevejde — appka tedy nešla
 * doručit vůbec.
 *
 * ⚠️ ZAPÍNÁ SE VÝSLOVNĚ, výchozí stav je „linkuj". Build, který schopnost
 * potřebuje, o ni nemůže omylem přijít.
 * ⚠️ CO SE ZTRATÍ: s vyřazenou Skiou by obrazovka `health.tsx` spadla, kdyby ji
 * někdo otevřel. V řidičově řezu (`vyvoz`) na ni nevede cesta; u buildu, který
 * ji nabízí, se `grafy` nevyřazují.
 *
 * ⭐ ROZHODUJE ZNAČKA INSTANCE (`brand.nativniSchopnosti`), ne tenhle soubor:
 * co appka umí, je vlastnost instance, ne stacku.
 */
module.exports = {
  dependencies: {
    ...(preskocitMlKit
      ? { '@react-native-ml-kit/text-recognition': { platforms: { ios: null, android: null } } }
      : {}),
    ...(preskocitHovory
      ? {
          '@livekit/react-native': { platforms: { ios: null, android: null } },
          '@livekit/react-native-webrtc': { platforms: { ios: null, android: null } },
        }
      : {}),
    ...(preskocitGrafy
      ? { '@shopify/react-native-skia': { platforms: { ios: null, android: null } } }
      : {}),
  },
};
