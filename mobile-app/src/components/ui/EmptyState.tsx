/**
 * Empty state placeholder.
 */
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, typography } from "@/theme";

interface EmptyStateProps {
  message: string;
  icon?: React.ReactNode;
}

export function EmptyState({ icon, message }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  icon: {
    opacity: 0.5,
  },
  text: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
  },
});
