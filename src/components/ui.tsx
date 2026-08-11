import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors, fonts } from "@/lib/theme";

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function BrandTitle() {
  return (
    <View style={styles.brandWrap}>
      <Text style={styles.brand}>Drawing-Battle</Text>
      <Text style={styles.tagline}>60 seconds. One prompt. AI picks the winner.</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  variant = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        variant === "primary" && styles.btnPrimary,
        variant === "secondary" && styles.btnSecondary,
        variant === "ghost" && styles.btnGhost,
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.white : colors.ink} />
      ) : (
        <Text
          style={[
            styles.btnText,
            variant === "primary" && styles.btnTextPrimary,
            variant !== "primary" && styles.btnTextDark,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 32,
  },
  brandWrap: {
    marginBottom: 28,
    gap: 8,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 42,
    lineHeight: 48,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.inkMuted,
    maxWidth: 320,
  },
  btn: {
    minHeight: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnSecondary: {
    backgroundColor: colors.paperDeep,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  btnGhost: {
    backgroundColor: "transparent",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    transform: [{ scale: 0.98 }],
  },
  btnText: {
    fontSize: 17,
    fontWeight: "700",
  },
  btnTextPrimary: {
    color: colors.white,
  },
  btnTextDark: {
    color: colors.ink,
  },
  error: {
    color: colors.danger,
    marginTop: 8,
    fontSize: 14,
  },
});
