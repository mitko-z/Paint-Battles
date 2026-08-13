import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
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

export function SuccessText({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Text style={styles.success}>{message}</Text>;
}

export function TextField({
  label,
  style,
  ...inputProps
}: { label?: string; style?: ViewStyle } & TextInputProps) {
  return (
    <View style={style}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.inkMuted} style={styles.field} {...inputProps} />
    </View>
  );
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.tabs}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      {label ? <Text style={styles.dividerLabel}>{label}</Text> : null}
      <View style={styles.dividerLine} />
    </View>
  );
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
  success: {
    color: colors.success,
    marginTop: 8,
    fontSize: 14,
  },
  fieldLabel: {
    color: colors.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  field: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 50,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.paperDeep,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.ink,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.inkMuted,
  },
  tabTextActive: {
    color: colors.white,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.inkMuted,
  },
  dividerLabel: {
    color: colors.inkMuted,
    fontSize: 13,
  },
});
