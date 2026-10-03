/**
 * Base card component with consistent styling.
 */
import { View, StyleSheet, type ViewStyle, type ViewProps } from "react-native";
import { colors, spacing } from "@/theme";

interface CardProps extends ViewProps {
  variant?: "default" | "elevated";
  style?: ViewStyle;
}

export function Card({ variant = "default", style, children, ...rest }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        variant === "elevated" && styles.elevated,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  elevated: {
    borderWidth: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
