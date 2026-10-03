/**
 * Naturel calibration (Z6) — three choices posed as work, not a questionnaire.
 * Skipping is legitimate: safe defaults apply and nothing is stored except the
 * skip itself (so the flow never nags again). Saving stores the style choice —
 * a preference, never a diagnosis (E1); the profile is the user's own (E4/E5).
 */
import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { CALIBRATION_STEPS, calibrationToProfile } from "@/naturel/calibration";
import { policyToWordKeys, resolvePolicy } from "@/naturel/policy";
import { useNaturel } from "@/naturel/NaturelProvider";
import { classifyFailure } from "@/services/offline";
import { zachranaPrace } from "@/lib/zachranaPrace";
import { zkusDvere } from "@/lib/obsluhaDveri";
import { nativeObsluhaDveri } from "@/lib/obsluhaDveri-native";

export default function NaturelCalibrationScreen() {
  const { t } = useTranslation();
  const { saveProfile, skipCalibration } = useNaturel();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Array<number | undefined>>([]);
  const [saving, setSaving] = useState(false);
  /*
    Nezdar ukládání je STAV OBRAZOVKY, ne výjimka, která uteče.

    ⛔ NAMĚŘENO 2026-09-05 na hlášení od majitele: po stisku „uložit" na jiné
    síti spadla CELÁ appka. Proč: `finish` mělo `try/finally` BEZ `catch`,
    takže odmítnutí z `saveProfile` propadlo ven z async funkce volané
    z `onPress` — neodchycené odmítnutí promise, a to v React Native shodí
    proces. Řidičova obrazovka se „jen" vyprázdnila, protože `catch` má;
    tady nebyl žádný.

    ⭐ `null` = nic se nepokazilo. Nedosazuje se výchozí stav „ok", protože
    ten by se nedal odlišit od „ještě jsme to nezkusili".
  */
  const [nezdar, setNezdar] = useState<"dvere" | "jiny" | null>(null);

  const done = step >= CALIBRATION_STEPS.length;

  const pick = (optIndex: number) => {
    const next = [...answers];
    next[step] = optIndex;
    setAnswers(next);
    setStep(step + 1);
  };

  /*
    Leaving the wizard must work from BOTH ways in.

    Opened from Settings it sits on a stack and back() returns there. But on the
    first authenticated entry it is reached via the root's <Redirect>, which
    REPLACES history — there is nothing to go back to, so back() is a no-op and
    the screen just stays. Nobody had ever walked that path: until the landing
    fix, login jumped straight to the tabs and skipped the wizard entirely; the
    day the wizard first appeared, both of its buttons "did nothing" (measured
    2026-08-03) — the save itself succeeded, only the exit was broken. Falling
    back to the root hands the decision to the ONE place that owns landing,
    same principle as the login fix.
  */
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  /*
    Příčinu POJMENOVÁVÁ hotové pravidlo, ne tahle obrazovka.

    `classifyFailure` + `zachranaPrace` už v repu jsou a rozhodují, jestli
    protistrana odmítla DATA, nebo NAŠI IDENTITU. Druhý případ je přesně ten,
    kdy má smysl nabídnout zaklepání. Kdyby si to obrazovka rozhodovala sama
    (třeba „obsahuje text 403"), vznikl by druhý domov téže otázky — a ty se
    rozejdou, jakmile se jeden z nich opraví.

    ⭐ `ulozit` z pravidla se tu vědomě NEPOUŽÍVÁ: profil nemá offline frontu,
    takže není kam ho odložit. Bereme jen tu část verdiktu, která tady dává
    smysl — a je to vidět, místo aby se mlčky ignorovala.
  */
  const zpracujNezdar = (error: unknown): boolean => {
    const { nabidnoutZaklepani } = zachranaPrace(classifyFailure(error));
    if (!nabidnoutZaklepani) setNezdar("jiny");
    return nabidnoutZaklepani;
  };

  /*
    ⭐ MEZI „ODMÍTLI NÁS" A „ZEPTEJ SE ČLOVĚKA" PATŘÍ JEDEN POKUS ZAŘÍZENÍ
    (zadání majitele, 9. 9.): *„aplikace nezjistí, jestli je schválená, jinak
    než tím, že po zaklepání stále nemá přístup k endpointům — a pak má smysl
    nabídnout ruční zaklepání platným kódem."*

    Dveře MLČÍ i při úspěchu, takže se appka nemá koho zeptat. Jediný
    pozorovatelný jev je ZMĚNA: nešlo to → zaťukal jsem → jde to? Proto se tu
    neptáme na stav, ale OPAKUJEME ÚKON. Pořadí kroků drží `zkusDvere`
    (`lib/obsluhaDveri.ts`) — obrazovka jen dodá, co se má zopakovat.

    ⛔ NEJVÝŠ DVA POKUSY a druhý jen po zaťukání ZAŘÍZENÍ. Mez je tady i přesto,
    že jedno zaťukání hlídá sdílená paměť pokusu: strop smyčky nesmí viset na
    stavu, který drží jiný modul — jinak by chyba tam znamenala smyčku tady.
  */
  const skrzeDvere = async (akce: () => Promise<void>): Promise<void> => {
    for (let pokus = 1; pokus <= 2; pokus++) {
      try {
        await akce();
        setNezdar(null);
        leave();
        return;
      } catch (error) {
        if (!zpracujNezdar(error)) return;
        const krok = await zkusDvere(false, nativeObsluhaDveri());
        if (krok.krok !== "zkus-znovu") break;
      }
    }
    // Sem se dojde jen dvěma cestami a obě znamenají totéž: automatika
    // nepomohla (nebo nebyla čím). Na řadě je člověk s platným kódem.
    setNezdar("dvere");
  };

  const finish = async () => {
    setSaving(true);
    setNezdar(null);
    try {
      await skrzeDvere(() => saveProfile(calibrationToProfile(answers).profile));
    } finally {
      setSaving(false);
    }
  };

  // I přeskočení zapisuje (aby se průvodce už neptal), takže padá stejně.
  const skip = () => skrzeDvere(() => skipCalibration());

  if (done) {
    const policy = resolvePolicy(calibrationToProfile(answers).profile);
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>{t("naturel.calibration.doneOverline")}</Text>
        <Text style={styles.question}>{t("naturel.calibration.doneTitle")}</Text>
        {policyToWordKeys(policy).map((w) => (
          <Text key={w.key} style={styles.word}>
            → {t(w.key, w.params)}
          </Text>
        ))}
        <TouchableOpacity style={styles.primaryBtn} onPress={finish} disabled={saving} testID="naturel-save">
          <Text style={styles.primaryBtnText}>{t("naturel.calibration.save")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => setStep(step - 1)}>
          <Text style={styles.ghostBtnText}>{t("naturel.calibration.back")}</Text>
        </TouchableOpacity>
      {/*
        NABÍDKA ZAKLEPÁNÍ PŘÍMO TADY — návrh majitele 2026-09-05.

        ⭐ Dotazník se vyplňuje při onboardingu, tedy ve chvíli, kdy člověk
        o dveřích právě slyšel. Když ho na cizí síti odmítnou, je to jediné
        místo, kde tu souvislost ještě má v hlavě.

        ⛔ Ukazuje se JEN po doloženém odmítnutí identity, ne „pro jistotu" —
        táž zásada jako v banneru u kroků: break-glass, který lidé vidí denně,
        přestane být break-glass. A ťuká vždycky ČLOVĚK, proto tlačítko a ne
        automatický pokus na pozadí.
      */}
      {nezdar && (
        <View style={styles.nezdar} testID="naturel-nezdar" accessibilityLiveRegion="polite">
          <Text style={styles.nezdarText}>
            {t(nezdar === "dvere" ? "naturel.calibration.deniedTitle" : "naturel.calibration.saveError")}
          </Text>
          {nezdar === "dvere" && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/zaklepat")}
              testID="naturel-zaklepat"
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>{t("naturel.calibration.knockAction")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
        <Text style={styles.footnote}>{t("naturel.calibration.footnote")}</Text>
      </ScrollView>
    );
  }

  const current = CALIBRATION_STEPS[step]!;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.overline}>{t(current.overlineKey)}</Text>
      <Text style={styles.question}>{t(current.questionKey)}</Text>
      {current.options.map((opt, i) => (
        <TouchableOpacity
          key={opt.titleKey}
          style={[styles.option, answers[step] === i && styles.optionSelected]}
          onPress={() => pick(i)}
          testID={`naturel-opt-${step}-${i}`}
        >
          <Text style={styles.optionTitle}>{t(opt.titleKey)}</Text>
          <Text style={styles.optionDetail}>{t(opt.detailKey)}</Text>
        </TouchableOpacity>
      ))}
      <View style={styles.row}>
        {step > 0 ? (
          <TouchableOpacity style={styles.ghostBtn} onPress={() => setStep(step - 1)}>
            <Text style={styles.ghostBtnText}>{t("naturel.calibration.back")}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.ghostBtn} onPress={skip} testID="naturel-skip">
            <Text style={styles.ghostBtnText}>{t("naturel.calibration.skip")}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.footnote}>{t("naturel.calibration.noWrongAnswer")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Nezdar nese TÓN slovem, ne jen barvou — barva je jediný kanál, který
  // v ostrém slunci ani při barvosleposti neprojde (zákon jazyka 01).
  nezdar: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  nezdarText: { ...typography.body },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  overline: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  question: { fontSize: typography.h3.fontSize, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  option: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionSelected: { borderColor: colors.primary },
  optionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  optionDetail: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  word: {
    color: colors.text,
    fontSize: 14,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: colors.background, fontWeight: "700", fontSize: 15 },
  ghostBtn: { padding: spacing.md, alignItems: "center", marginTop: spacing.xs },
  ghostBtnText: { color: colors.textSecondary, fontSize: 14 },
  footnote: { color: colors.textMuted, fontSize: 12.5, marginTop: spacing.md },
});
