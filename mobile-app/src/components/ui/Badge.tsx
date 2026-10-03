/**
 * Badge / pill component for labels and counts.
 */
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { colors, spacing } from "@/theme";

interface BadgeProps {
  label: string;
  color?: string;
  textColor?: string;
  style?: ViewStyle;
  size?: "sm" | "md";
}

export function Badge({
  color = colors.primary,
  label,
  size = "sm",
  style,
  textColor = colors.text,
}: BadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: color + "20", borderColor: color },
        size === "md" && styles.badgeMd,
        style,
      ]}
    >
      <Text style={[styles.label, { color: textColor }, size === "md" && styles.labelMd]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 100,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  badgeMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
  labelMd: {
    fontSize: 13,
  },
});
