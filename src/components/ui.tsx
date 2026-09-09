import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/lib/theme";

export function Screen({
  children,
  style,
  scroll = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Screens with their own gesture-sensitive layout (the drawing canvas'
   * touch handling) opt out - see app/match/[id].tsx. Every other screen
   * gets this for free: on a short landscape phone, content that doesn't
   * fit becomes scrollable instead of literally unreachable below the
   * viewport. When content already fits (the common case), this is a
   * no-op - flexGrow on the content container plus flex:1 on the inner
   * View is the standard RN idiom for "fill the screen, but scroll if you
   * can't." */
  scroll?: boolean;
}) {
  const content = <View style={[styles.screen, style]}>{children}</View>;
  if (!scroll) return content;
  return (
    <ScrollView style={styles.scrollFill} contentContainerStyle={styles.scrollContent}>
      {content}
    </ScrollView>
  );
}

// "Battle Poster" wordmark treatment: React Native's Text only supports a single
// textShadow (color/offset/radius), so the layered red+blue "paint drip" look - easy
// in CSS with multiple text-shadows - is faked the same way a comic/poster chromatic
// outline usually is in RN: two extra copies of the same text, absolutely positioned a
// couple px off in each accent color, sitting underneath the real (non-absolute) copy
// that actually establishes the layout size. Shared here so both the lobby wordmark and
// the results screen's "You win"/"You lose" headline use the same effect.
export function DripText({
  children,
  style,
  containerStyle,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: ViewStyle;
}) {
  const topText = children + " "; // extra space to avoid clipping the right edge of the red drip
  return (
    <View style={[styles.dripStack, containerStyle]}>
      <Text
        style={[style, styles.dripBlue]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </Text>
      <Text
        style={[style, styles.dripRed]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </Text>
      <Text style={style}>{topText}</Text>
    </View>
  );
}

export function BrandTitle() {
  return (
    <View style={styles.brandWrap}>
      <DripText style={styles.brand}>Paint Battles</DripText>
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
  // Wood/leather bevel: a top-to-bottom gradient fill plus a darker flat bottom
  // border reads as a chunky, slightly worn game button without needing any image
  // assets - primary in the paint-drip red, secondary in a darker panel navy so it
  // still reads as a button sitting on the same dark screen. Ghost stays flat/bare.
  const gradient =
    variant === "primary"
      ? (["#E4415A", colors.accent] as const)
      : variant === "secondary"
        ? (["#3C597A", colors.paperDeep] as const)
        : null;

  const inner = loading ? (
    <ActivityIndicator color={variant === "primary" ? colors.white : colors.ink} />
  ) : (
    <Text
      style={[
        styles.btnText,
        variant === "primary" ? styles.btnTextPrimary : styles.btnTextDark,
      ]}
    >
      {label}
    </Text>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [pressed && !disabled && styles.btnPressed, style]}
    >
      {gradient ? (
        <LinearGradient
          colors={gradient}
          style={[
            styles.btn,
            variant === "primary" ? styles.btnPrimaryBevel : styles.btnSecondaryBevel,
            (disabled || loading) && styles.btnDisabled,
          ]}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={[styles.btn, styles.btnGhost, (disabled || loading) && styles.btnDisabled]}>
          {inner}
        </View>
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
  scrollFill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
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
  dripStack: {
    position: "relative",
    alignSelf: "flex-start",
  },
  dripBlue: {
    position: "absolute",
    top: 2,
    left: -2,
    color: colors.blue,
  },
  dripRed: {
    position: "absolute",
    top: 3,
    left: 2,
    color: colors.accent,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.ink,
  },
  tagline: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.gold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    maxWidth: 320,
  },
  btn: {
    minHeight: 52,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  btnPrimaryBevel: {
    borderBottomWidth: 3,
    borderBottomColor: "#7C0F1F",
  },
  btnSecondaryBevel: {
    borderBottomWidth: 3,
    borderBottomColor: "#0F1922",
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
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
    fontFamily: fonts.body,
  },
  success: {
    color: colors.success,
    marginTop: 8,
    fontSize: 14,
    fontFamily: fonts.body,
  },
  fieldLabel: {
    color: colors.inkMuted,
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  field: {
    borderWidth: 1.5,
    borderColor: colors.inkMuted,
    borderRadius: 9,
    paddingHorizontal: 14,
    minHeight: 50,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.ink,
    backgroundColor: colors.paperDeep,
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
    backgroundColor: colors.accent,
  },
  tabText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
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
    fontFamily: fonts.body,
  },
});
