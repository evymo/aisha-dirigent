/**
 * Styled button with variants.
 */
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
} from "react-native";
import { colors, spacing, typography } from "@/theme";

interface ButtonProps {
  disabled?: boolean;
  isLoading?: boolean;
  label: string;
  onPress: () => void;
  style?: ViewStyle;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export function Button({
  disabled = false,
  isLoading = false,
  label,
  onPress,
  style,
  variant = "primary",
}: ButtonProps) {
  const buttonStyle = [
    styles.base,
    variant === "primary" && styles.primary,
    variant === "secondary" && styles.secondary,
    variant === "ghost" && styles.ghost,
    variant === "danger" && styles.danger,
    (disabled || isLoading) && styles.disabled,
    style,
  ];

  const textStyle = [
    styles.label,
    variant === "ghost" && styles.ghostLabel,
    variant === "danger" && styles.dangerLabel,
    (disabled || isLoading) && styles.disabledLabel,
  ];

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.7}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  danger: {
    backgroundColor: colors.error + "15",
    borderWidth: 1,
    borderColor: colors.error,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.body,
    fontWeight: "600",
    color: colors.text,
  },
  ghostLabel: {
    color: colors.primary,
  },
  dangerLabel: {
    color: colors.error,
  },
  disabledLabel: {
    color: colors.textMuted,
  },
});
