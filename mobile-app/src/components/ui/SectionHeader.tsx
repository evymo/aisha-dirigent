/**
 * Section header with optional action.
 */
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, spacing, typography } from "@/theme";

interface SectionHeaderProps {
  actionLabel?: string;
  onAction?: () => void;
  title: string;
}

export function SectionHeader({ actionLabel, onAction, title }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.h3,
  },
  action: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: "600",
  },
});
