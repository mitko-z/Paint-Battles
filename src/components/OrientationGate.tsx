import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, fonts } from "@/lib/theme";

/**
 * Paint Battles' key art (splash/lobby videos) and overall layout are designed for
 * widescreen. Native builds are OS-locked to landscape via app.json's
 * `orientation: "landscape"` - the phone physically cannot render portrait there, so
 * this component is a no-op on native (width > height is already guaranteed).
 *
 * The web can't be OS-locked the same way: Safari has never implemented the Screen
 * Orientation Lock API, and CSS-rotating the whole page to fake landscape breaks the
 * touch/gesture coordinate mapping react-native-gesture-handler relies on for the
 * drawing canvas. So on web we instead block portrait viewports behind a simple
 * "rotate your device" prompt and only render the app once the viewport is actually
 * wider than it is tall - no transform trickery, no risk to drawing input.
 */
export function OrientationGate({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== "web") return <>{children}</>;

  const isPortrait = height > width;
  if (!isPortrait) return <>{children}</>;

  return (
    <View style={styles.root}>
      <Text style={styles.icon}>⟳</Text>
      <Text style={styles.title}>Turn your device sideways</Text>
      <Text style={styles.body}>
        Paint Battles is a widescreen game — rotate your phone or tablet to landscape to
        play.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  icon: {
    fontSize: 48,
    color: colors.gold,
    marginBottom: 8,
    transform: [{ rotate: "90deg" }],
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    textAlign: "center",
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkMuted,
    textAlign: "center",
    lineHeight: 22,
  },
});
