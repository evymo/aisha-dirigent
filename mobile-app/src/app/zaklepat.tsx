/**
 * Obrazovka „Zaklepat na dveře".
 *
 * Samotné klepátko žije v `@/components/Klepatko` — bez routeru, aby se dalo
 * vykreslit i na záchytné obrazovce v `_layout.tsx`, kde žádný `<Stack>`
 * nestojí. Tahle obrazovka je jen jeho zarámování do navigace.
 */
import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { Klepatko } from "@/components";
import { useTranslation } from "@/hooks";
import { colors, spacing } from "@/theme";

export default function ZaklepatScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t("knock.title") }} />
      <Klepatko onHotovo={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    backgroundColor: colors.background,
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
});
