/**
 * Status dot indicator.
 */
import { View, StyleSheet, type ViewStyle } from "react-native";

interface StatusDotProps {
  color: string;
  size?: number;
  style?: ViewStyle;
}

export function StatusDot({ color, size = 8, style }: StatusDotProps) {
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: color, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
